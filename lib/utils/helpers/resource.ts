import path from 'node:path';
import {fs, zip} from '@appium/support';
import {log} from '../../logger';
import {MODULE_NAME} from './constants';
import {memoize} from '../lodash';

// Declare __filename for CommonJS compatibility
declare const __filename: string;

export const getResourcePath = memoize(async function getResourcePath(
  relPath: string
): Promise<string> {
  const moduleRoot = await getModuleRoot();
  const resultPath = path.resolve(moduleRoot, relPath);
  if (!(await fs.exists(resultPath))) {
    throw new Error(
      `Cannot find the resource '${relPath}' under the '${moduleRoot}' ` +
        `folder of ${MODULE_NAME} Node.js module`
    );
  }
  return resultPath;
});

export async function unzipFile(zipPath: string, dstRoot: string = path.dirname(zipPath)): Promise<void> {
  log.debug(`Unzipping '${zipPath}' to '${dstRoot}'`);
  await zip.assertValidZip(zipPath);
  await zip.extractAllTo(zipPath, dstRoot);
  log.debug('Unzip successful');
}

const getModuleRoot = memoize(async function getModuleRoot(): Promise<string> {
  let moduleRoot = path.dirname(path.resolve(__filename));
  let isAtFsRoot = false;
  while (!isAtFsRoot) {
    const manifestPath = path.join(moduleRoot, 'package.json');
    try {
      if (await fs.exists(manifestPath)) {
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent) as {name?: string};
        if (manifest.name === MODULE_NAME) {
          return moduleRoot;
        }
      }
    } catch {
      // Ignore errors and continue searching
    }
    const parentDir = path.dirname(moduleRoot);
    isAtFsRoot = moduleRoot.length <= parentDir.length;
    moduleRoot = parentDir;
  }
  if (isAtFsRoot) {
    throw new Error(`Cannot find the root folder of the ${MODULE_NAME} Node.js module`);
  }
  return moduleRoot;
});
