//import chai from 'chai';
import { getActivityRelativeName } from '../../lib/helpers';

describe('helpers', () => {
  describe('getActivityRelativeName', () => {
    it('should correctly remove pkg from pkg.activity.name', () => {
      getActivityRelativeName('pkg', 'pkg.activity.name')
        .should.equal('.activity.name');
    });
    it('should return .act.name when act.name is passed', () => {
      getActivityRelativeName('pkg', 'act.name')
        .should.equal('.act.name');
    });
    it('should not amend a valid activity name', () => {
      getActivityRelativeName('pkg', '.activity.name')
        .should.equal('.activity.name');
    });
  });
});
