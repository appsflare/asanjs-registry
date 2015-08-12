
export class ControllerConnector {
    constructor(controllerType, options) {
        this.controllerType = controllerType;
        options.lifecycle = options.lifecycle || {
            created: function () {

            },
            removed: function () {

            }
        };

        this._created = options.lifecycle.created;
        this._removed = options.lifecycle.removed;
        var me = this;
        //intercept created lifecycle method to create controller instance for the element and bind
        options.lifecycle.created = function () {
            this.controller = new me.controllerType(this);

            //if control is templating enable provide control its chance to pre-process template
            if (me.options.template) {
                var templatePromise = new Promise(( resolve, reject) => resolve(me.options.template));
                if (this.controller.attachingTemplate) {
                    templatePromise = this.controller.attachingTemplate(me.options.template);
                }
            templatePromise
            .then(value => {
              //once the template is ready attach it to the current control
              this.appendChild(xtag.createFragment(value));

              //let controller know that the template has been attached
                if (this.controller.attachedTemplate) {
                    this.controller.attachedTemplate();
                }
            });
            }
            me._created.apply(this, arguments);
        };

        options.lifecycle.removed = function () {
            if (!this.controller) {
                return;
            }
            if(this.controller.destroying)
            {
              this.controller.destroying.apply(this,arguments);
            }

            me._removed.apply(this, arguments);

            this.controller = undefined;
        };
        me.options = options;


    }

    static connect(controllerType, options) {
        return new ControllerConnector(controllerType, options).options;
    }
};
