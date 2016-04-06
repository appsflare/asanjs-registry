'use strict';

System.register(['core-js'], function (_export, _context) {
    var core, ControllerConnector;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    return {
        setters: [function (_coreJs) {
            core = _coreJs.default;
        }],
        execute: function () {
            _export('ControllerConnector', ControllerConnector = function () {
                function ControllerConnector(controllerType, options) {
                    _classCallCheck(this, ControllerConnector);

                    this.controllerType = controllerType;
                    options.lifecycle = Object.assign({
                        created: function created() {},
                        removed: function removed() {},
                        inserted: function inserted() {}
                    }, options.lifecycle || {});

                    this._created = options.lifecycle.created;
                    this._removed = options.lifecycle.removed;
                    this._inserted = options.lifecycle.inserted;

                    var me = this;

                    options.lifecycle.created = function () {
                        this.controller = new me.controllerType(this);

                        if (me.options.template) {
                            var templatePromise = new Promise(function (resolve, reject) {
                                return resolve(me.options.template);
                            });
                            if (this.controller.processingTemplate) {
                                this.controller.___templatePromise___ = this.controller.processingTemplate(me.options.template);
                            }
                        }
                        this.controller.created && this.controller.created.apply(this.controller, arguments);
                        me._created.apply(this, arguments);
                    };

                    options.lifecycle.inserted = function () {
                        var _this = this;

                        me._inserted.apply(me, arguments);
                        this.controller.inserted && this.controller.inserted.apply(this.controller, arguments);

                        if (!this.controller.___templatePromise___) return;

                        var templatePromise = this.controller.___templatePromise___;

                        templatePromise.then(function (value) {

                            var attachingTemplPromise = Promise.resolve(value);
                            if (_this.controller.attachingTemplate) {
                                attachingTemplPromise = _this.controller.attachingTemplate(value);
                            }

                            attachingTemplPromise.then(function (templ) {
                                _this.appendChild(xtag.createFragment(templ));

                                if (_this.controller.attachedTemplate) {
                                    _this.controller.attachedTemplate();
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

                ControllerConnector.connect = function connect(controllerType, options) {
                    return new ControllerConnector(controllerType, options).options;
                };

                return ControllerConnector;
            }());

            _export('ControllerConnector', ControllerConnector);

            ;
        }
    };
});
//# sourceMappingURL=data:application/json;base64,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
