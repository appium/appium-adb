import {fs, system} from '@appium/support';
import path from 'node:path';
import {util} from '@appium/support';

export function getSdkRootFromEnv(): string | undefined {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
}

export async function requireSdkRoot(customRoot: string | null = null): Promise<string> {
  const sdkRoot = customRoot || getSdkRootFromEnv();
  const docMsg =
    'Read https://developer.android.com/studio/command-line/variables for more details';
  if (!sdkRoot || util.isEmpty(sdkRoot)) {
    throw new Error(
      `Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported. ${docMsg}`
    );
  }
  if (!(await fs.exists(sdkRoot))) {
    throw new Error(
      `The Android SDK root folder '${sdkRoot}' does not exist on the local file system. ${docMsg}`
    );
  }

  const stats = await fs.stat(sdkRoot);
  if (!stats.isDirectory()) {
    throw new Error(`The Android SDK root '${sdkRoot}' must be a folder. ${docMsg}`);
  }
  return sdkRoot;
}

export const getJavaHome = util.memoize(async function getJavaHome(): Promise<string> {
  const result = process.env.JAVA_HOME;
  if (!result) {
    throw new Error('The JAVA_HOME environment variable is not set for the current process');
  }
  if (!(await fs.exists(result))) {
    throw new Error(`The JAVA_HOME location '${result}' must exist`);
  }
  const stats = await fs.stat(result);
  if (!stats.isDirectory()) {
    throw new Error(`The JAVA_HOME location '${result}' must be a valid folder`);
  }
  return result;
});

export const getJavaForOs = util.memoize(async function getJavaForOs(): Promise<string> {
  let javaHome: string | undefined;
  let errMsg: string | undefined;
  try {
    javaHome = await getJavaHome();
  } catch (err: unknown) {
    const error = err as Error;
    errMsg = error.message;
  }
  const executableName = `java${system.isWindows() ? '.exe' : ''}`;
  if (javaHome) {
    const resultPath = path.resolve(javaHome, 'bin', executableName);
    if (await fs.exists(resultPath)) {
      return resultPath;
    }
  }
  try {
    return await fs.which(executableName);
  } catch {
    // Ignore and throw custom error below
  }
  throw new Error(
    `The '${executableName}' binary could not be found ` +
      `neither in PATH nor under JAVA_HOME (${javaHome ? path.resolve(javaHome, 'bin') : errMsg})`
  );
});
