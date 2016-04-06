'use strict';

System.register(['./controllerConnector', 'x-tag'], function (_export, _context) {
	var ControllerConnector, xtag, Elements, Registry;

	function _classCallCheck(instance, Constructor) {
		if (!(instance instanceof Constructor)) {
			throw new TypeError("Cannot call a class as a function");
		}
	}

	return {
		setters: [function (_controllerConnector) {
			ControllerConnector = _controllerConnector.ControllerConnector;
		}, function (_xTag) {
			xtag = _xTag.default;
		}],
		execute: function () {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInJlZ2lzdHJ5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7QUFDUzs7QUFDRjs7O0FBRUgsY0FBVzs7dUJBRUY7Ozs7O2FBRUwsNkJBQVMsU0FBUyxnQkFBZ0IsU0FBUTtBQUNoRCxZQUFPLFNBQVMsZUFBZSxJQUFmLENBQVQsR0FBZ0MsS0FBSyxRQUFMLENBQWMsT0FBZCxFQUF1QixvQkFBb0IsT0FBcEIsQ0FBNEIsY0FBNUIsRUFBNEMsT0FBNUMsQ0FBdkIsQ0FBaEMsQ0FEeUM7OztBQUZyQyxhQU1MLHlCQUFPLFNBQVE7O0FBT3JCLFlBQU8sU0FBUyxhQUFULENBQXVCLE9BQXZCLENBQVAsQ0FQcUI7OztXQU5WIiwiZmlsZSI6InJlZ2lzdHJ5LmpzIiwic291cmNlUm9vdCI6Ii9zcmMifQ==
