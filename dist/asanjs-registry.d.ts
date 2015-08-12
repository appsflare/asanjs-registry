declare module 'asanjs-registry' {
  import  from 'asanjs-registry/x-tag-lib';
  import xtag from 'asanjs-registry/xtag';
  
  // import './lib/x-tag-components.min.css!';
  export default undefined;
  export class ControllerConnector {
    constructor(controllerType: any, options: any);
    static connect(controllerType: any, options: any): any;
  }
  export class Registry {
    static register(tagName: any, controllerType: any, options: any): any;
    static create(tagName: any): any;
  }
}