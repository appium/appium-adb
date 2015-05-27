let methods = {};

methods.getAdbWithCorrectAdbPath = async function () {
  this.adb.path = await this.getSdkBinaryPath("adb");
  this.binaries.adb = this.adb.path;
  return this.adb;
};

methods.initAapt = async function () {
  this.binaries.aapt = await this.getSdkBinaryPath("aapt");
};

methods.initZipAlign = async function() {
  this.binaries.zipalign = await this.getSdkBinaryPath("zipalign");
};

export default methods;
