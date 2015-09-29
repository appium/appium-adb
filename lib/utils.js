import path from 'path';

const rootDir = path.resolve(__dirname, process.env.NO_PRECOMPILE ? '..' : '../..'),
      androidPlatforms = ['android-4.2', 'android-17', 'android-4.3', 'android-18',
                          'android-4.4', 'android-19', 'android-L', 'android-20',
                          'android-5.0', 'android-21', 'android-22', 'android-MNC',
                          'android-23', 'android-6.0'];

export { rootDir, androidPlatforms };
