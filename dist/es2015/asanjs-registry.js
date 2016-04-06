import core from 'core-js';
import xtag from 'x-tag';

export let ControllerConnector = class ControllerConnector {
    constructor(controllerType, options) {
        this.controllerType = controllerType;
        options.lifecycle = Object.assign({
            created: function () {},
            removed: function () {},
            inserted: function () {}
        }, options.lifecycle || {});

        this._created = options.lifecycle.created;
        this._removed = options.lifecycle.removed;
        this._inserted = options.lifecycle.inserted;

        var me = this;

        options.lifecycle.created = function () {
            this.controller = new me.controllerType(this);

            if (me.options.template) {
                let templatePromise = new Promise((resolve, reject) => resolve(me.options.template));
                if (this.controller.processingTemplate) {
                    this.controller.___templatePromise___ = this.controller.processingTemplate(me.options.template);
                }
            }
            this.controller.created && this.controller.created.apply(this.controller, arguments);
            me._created.apply(this, arguments);
        };

        options.lifecycle.inserted = function () {
            me._inserted(...arguments);
            this.controller.inserted && this.controller.inserted.apply(this.controller, arguments);

            if (!this.controller.___templatePromise___) return;

            let templatePromise = this.controller.___templatePromise___;

            templatePromise.then(value => {

                let attachingTemplPromise = Promise.resolve(value);
                if (this.controller.attachingTemplate) {
                    attachingTemplPromise = this.controller.attachingTemplate(value);
                }

                attachingTemplPromise.then(templ => {
                    this.appendChild(xtag.createFragment(templ));

                    if (this.controller.attachedTemplate) {
                        this.controller.attachedTemplate();
                    }
                });
            });
        };

        options.lifecycle.removed = function () {
            if (!this.controller) {
                return;
            }

            if (!this.controller.isSuspended() && this.controller.destroying) {
                this.controller.destroying.apply(this, arguments);
            }

            this.controller.removed && this.controller.removed.apply(this.controller, arguments);
            me._removed.apply(this, arguments);

            if (!this.controller.isSuspended()) {
                this.controller = undefined;
            }
        };
        me.options = options;
    }

    static connect(controllerType, options) {
        return new ControllerConnector(controllerType, options).options;
    }
};;

let Elements = {};

export let Registry = class Registry {

    static register(tagName, controllerType, options) {
        return Elements[controllerType.name] = xtag.register(tagName, ControllerConnector.connect(controllerType, options));
    }

    static create(tagName) {

        return document.createElement(tagName);
    }
};