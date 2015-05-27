import methods from './adb-commands.js';
import manifestMethods from './android-manifest.js';
import systemCallMethods from './system-calls.js';

Object.assign(
    methods,
    manifestMethods,
    systemCallMethods
);

export default methods;
