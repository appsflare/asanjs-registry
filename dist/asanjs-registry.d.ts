declare module 'asanjs-registry' {
  import core from 'core-js';
  export class ControllerConnector {
    constructor(controllerType: any, options: any);
    static connect(controllerType: any, options: any): any;
  }
  export class Registry {
    static register(tagName: any, controllerType: any, options: any): any;
    static create(tagName: any): any;
  }
}