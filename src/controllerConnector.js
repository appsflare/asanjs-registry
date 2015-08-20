import core from 'core-js';

export class ControllerConnector {
    constructor(controllerType, options) {
        this.controllerType = controllerType;
        options.lifecycle = Object.assign({
            created: function () {

            },
            removed: function () {

            },
            inserted: function () {

            }
        }, options.lifecycle || {});

        this._created = options.lifecycle.created;
        this._removed = options.lifecycle.removed;
        this._inserted = options.lifecycle.inserted;

        var me = this;
        //intercept created lifecycle method to create controller instance for the element and bind
        options.lifecycle.created = function () {
            this.controller = new me.controllerType(this);

            //if control is templating enable provide control its chance to pre-process template
            if (me.options.template) {
                var templatePromise = new Promise((resolve, reject) => resolve(me.options.template));
                if (this.controller.processingTemplate) {
                    this.controller.___templatePromise___ = this.controller.processingTemplate(me.options.template);
                }
            }
            this.controller.created && this.controller.created.apply(this.controller, arguments);
            me._created.apply(this, arguments);
        };

        //intercept inserted lifecycle method to make handling of extra stuffs possible
        options.lifecycle.inserted = function () {
            me._inserted(...arguments);
            this.controller.inserted && this.controller.inserted.apply(this.controller, arguments);

            if (!this.controller.___templatePromise___) return;


            let templatePromise = this.controller.___templatePromise___;

            var p = new Promise();


            templatePromise
                .then(value => {

                    let attachingTemplPromise = Promise.resolve(value);
                    if (this.controller.attachingTemplate) {
                        attachingTemplPromise = this.controller.attachingTemplate(value);
                    }

                    attachingTemplPromise.then(templ => {



                        //once the template is ready attach it to the current control
                        this.appendChild(xtag.createFragment(templ));

                        //let controller know that the template has been attached
                        if (this.controller.attachedTemplate) {
                            this.controller.attachedTemplate();
                        }
                    });
                });
        }

        options.lifecycle.removed = function () {
            //if the controller is not created don't run cleanup
            if (!this.controller) {
                return;
            }

            //if the element is temporarily suspended and we should skip destroy cycle
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
};
