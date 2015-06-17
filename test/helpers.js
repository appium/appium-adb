import 'mochawait';
import sinon from 'sinon';
import _ from 'lodash';

function withMocks (libs, fn) {
  return () => {
    let mocks = {};
    beforeEach(() => {
      for (let [key, value] of _.pairs(libs)) {
        mocks[key] = sinon.mock(value);
      }
    });
    afterEach(() => {
      for (let name of Object.keys(libs)) {
        mocks[name].restore();
      }
    });
    fn(mocks);
  };
}

export { withMocks };
