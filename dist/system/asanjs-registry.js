'use strict';

System.register(['core-js', 'x-tag'], function (_export, _context) {
    var core, xtag, ControllerConnector, Elements, Registry;

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    return {
        setters: [function (_coreJs) {
            core = _coreJs.default;
        }, function (_xTag) {
            xtag = _xTag.default;
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

            Elements = {};

            _export('Registry', Registry = function () {
                function Registry() {
                    _classCallCheck(this, Registry);
                }

                Registry.register = function register(tagName, controllerType, options) {
                    return Elements[controllerType.name] = xtag.register(tagName, ControllerConnector.connect(controllerType, options));
                };

                Registry.create = function create(tagName) {

                    return document.createElement(tagName);
                };

                return Registry;
            }());

            _export('Registry', Registry);
        }
    };
});