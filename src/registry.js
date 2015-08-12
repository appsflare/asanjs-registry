//import xtag from './xtag';
import { ControllerConnector } from './controllerConnector';

let Elements = {};

export class Registry {

	static register(tagName, controllerType, options){
		return Elements[controllerType.name] = window.xtag.register(tagName, ControllerConnector.connect(controllerType, options));
	}

	static create(tagName){
		//TODO: for known elements try to create instance directly from Elements store
		// if(Elements.hasOwnProperty(tagName))
		// {
		// 	return new Elements
		// }

		return document.createElement(tagName);
	}
}


