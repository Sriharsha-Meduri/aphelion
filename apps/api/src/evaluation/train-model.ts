import 'dotenv/config';
import { generateDataset, DEFAULT_DATASET, toContext } from './generator';
import { extractFeatures, FEATURE_NAMES } from '../recovery/features';
import { fitStandardizer, standardize, fitLogistic, rawLogit, sigmoid } from '../recovery/logistic';
import { fitPlatt, applyCalibration, identityCalibration } from '../recovery/calibration';
import { saveModel, type RecoveryModel } from '../recovery/model';
import { rocAuc, prAuc, brier, ece, baseRate } from './metrics';
import { MODEL_PATH } from '../container';

/**
 * Train the recovery-probability model. Fit the logistic regression on the
 * train split, fit Platt calibration on the validation split, and report
 * metrics on the held-out test split only. The test split never influences
 * training or calibration.
 */
function main(): void {
  const cfg = DEFAULT_DATASET;
  const ds = generateDataset(cfg);
  const train = ds.filter((s) => s.split === 'train');
  const val = ds.filter((s) => s.split === 'val');
  const test = ds.filter((s) => s.split === 'test');

  const featureOf = (s: (typeof ds)[number]) => extractFeatures(toContext(s));

  const Xtrain = train.map(featureOf);
  const ytrain = train.map((s) => s.labelRecoverIfLink);
  const standardizer = fitStandardizer(Xtrain);
  const Xs = Xtrain.map((x) => standardize(standardizer, x));
  const logistic = fitLogistic(Xs, ytrain, { epochs: 600, learningRate: 0.15, l2: 1e-3 });

  const valLogits = val.map((s) => rawLogit(logistic, standardize(standardizer, featureOf(s))));
  const yval = val.map((s) => s.labelRecoverIfLink);
  const platt = fitPlatt(valLogits, yval);

  // Choose calibration on validation only: keep Platt if it improves val ECE,
  // otherwise fall back to the raw logistic probability (identity).
  const eceValRaw = ece(valLogits.map(sigmoid), yval);
  const eceValPlatt = ece(valLogits.map((z) => applyCalibration(platt, z)), yval);
  const calibration = eceValPlatt <= eceValRaw ? platt : identityCalibration();

  const testLogits = test.map((s) => rawLogit(logistic, standardize(standardizer, featureOf(s))));
  const ytest = test.map((s) => s.labelRecoverIfLink);
  const probCal = testLogits.map((z) => applyCalibration(calibration, z));
  const probRaw = testLogits.map((z) => sigmoid(z));

  const metrics = {
    nTrain: train.length,
    nVal: val.length,
    nTest: test.length,
    baseRate: round(baseRate(ytest)),
    rocAuc: round(rocAuc(probCal, ytest)),
    prAuc: round(prAuc(probCal, ytest)),
    brier: round(brier(probCal, ytest)),
    eceRaw: round(ece(probRaw, ytest)),
    eceCalibrated: round(ece(probCal, ytest)),
  };

  const model: RecoveryModel = {
    version: 'recovery-lr-v1',
    trainedAt: new Date().toISOString(),
    seed: cfg.seed,
    featureNames: [...FEATURE_NAMES],
    standardizer,
    logistic,
    calibration,
    metrics,
  };
  saveModel(MODEL_PATH, model);

  console.log('[train] model saved to', MODEL_PATH);
  console.log('[train] test metrics', JSON.stringify(metrics, null, 2));
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}

main();
