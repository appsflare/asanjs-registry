
import './x-tag-lib';
//import './lib/x-tag-components.min.css!';

export default window.xtag;

/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

if (typeof WeakMap === 'undefined') {
  (function() {
    var defineProperty = Object.defineProperty;
    var counter = Date.now() % 1e9;

    var WeakMap = function() {
      this.name = '__st' + (Math.random() * 1e9 >>> 0) + (counter++ + '__');
    };

    WeakMap.prototype = {
      set: function(key, value) {
        var entry = key[this.name];
        if (entry && entry[0] === key)
          entry[1] = value;
        else
          defineProperty(key, this.name, {value: [key, value], writable: true});
      },
      get: function(key) {
        var entry;
        return (entry = key[this.name]) && entry[0] === key ?
            entry[1] : undefined;
      },
      delete: function(key) {
        this.set(key, undefined);
      }
    };

    window.WeakMap = WeakMap;
  })();
}

/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(global) {

  var registrationsTable = new WeakMap();

  // We use setImmediate or postMessage for our future callback.
  var setImmediate = window.msSetImmediate;

  // Use post message to emulate setImmediate.
  if (!setImmediate) {
    var setImmediateQueue = [];
    var sentinel = String(Math.random());
    window.addEventListener('message', function(e) {
      if (e.data === sentinel) {
        var queue = setImmediateQueue;
        setImmediateQueue = [];
        queue.forEach(function(func) {
          func();
        });
      }
    });
    setImmediate = function(func) {
      setImmediateQueue.push(func);
      window.postMessage(sentinel, '*');
    };
  }

  // This is used to ensure that we never schedule 2 callas to setImmediate
  var isScheduled = false;

  // Keep track of observers that needs to be notified next time.
  var scheduledObservers = [];

  /**
   * Schedules |dispatchCallback| to be called in the future.
   * @param {MutationObserver} observer
   */
  function scheduleCallback(observer) {
    scheduledObservers.push(observer);
    if (!isScheduled) {
      isScheduled = true;
      setImmediate(dispatchCallbacks);
    }
  }

  function wrapIfNeeded(node) {
    return window.ShadowDOMPolyfill &&
        window.ShadowDOMPolyfill.wrapIfNeeded(node) ||
        node;
  }

  function dispatchCallbacks() {
    // http://dom.spec.whatwg.org/#mutation-observers

    isScheduled = false; // Used to allow a new setImmediate call above.

    var observers = scheduledObservers;
    scheduledObservers = [];
    // Sort observers based on their creation UID (incremental).
    observers.sort(function(o1, o2) {
      return o1.uid_ - o2.uid_;
    });

    var anyNonEmpty = false;
    observers.forEach(function(observer) {

      // 2.1, 2.2
      var queue = observer.takeRecords();
      // 2.3. Remove all transient registered observers whose observer is mo.
      removeTransientObserversFor(observer);

      // 2.4
      if (queue.length) {
        observer.callback_(queue, observer);
        anyNonEmpty = true;
      }
    });

    // 3.
    if (anyNonEmpty)
      dispatchCallbacks();
  }

  function removeTransientObserversFor(observer) {
    observer.nodes_.forEach(function(node) {
      var registrations = registrationsTable.get(node);
      if (!registrations)
        return;
      registrations.forEach(function(registration) {
        if (registration.observer === observer)
          registration.removeTransientObservers();
      });
    });
  }

  /**
   * This function is used for the "For each registered observer observer (with
   * observer's options as options) in target's list of registered observers,
   * run these substeps:" and the "For each ancestor ancestor of target, and for
   * each registered observer observer (with options options) in ancestor's list
   * of registered observers, run these substeps:" part of the algorithms. The
   * |options.subtree| is checked to ensure that the callback is called
   * correctly.
   *
   * @param {Node} target
   * @param {function(MutationObserverInit):MutationRecord} callback
   */
  function forEachAncestorAndObserverEnqueueRecord(target, callback) {
    for (var node = target; node; node = node.parentNode) {
      var registrations = registrationsTable.get(node);

      if (registrations) {
        for (var j = 0; j < registrations.length; j++) {
          var registration = registrations[j];
          var options = registration.options;

          // Only target ignores subtree.
          if (node !== target && !options.subtree)
            continue;

          var record = callback(options);
          if (record)
            registration.enqueue(record);
        }
      }
    }
  }

  var uidCounter = 0;

  /**
   * The class that maps to the DOM MutationObserver interface.
   * @param {Function} callback.
   * @constructor
   */
  function JsMutationObserver(callback) {
    this.callback_ = callback;
    this.nodes_ = [];
    this.records_ = [];
    this.uid_ = ++uidCounter;
  }

  JsMutationObserver.prototype = {
    observe: function(target, options) {
      target = wrapIfNeeded(target);

      // 1.1
      if (!options.childList && !options.attributes && !options.characterData ||

          // 1.2
          options.attributeOldValue && !options.attributes ||

          // 1.3
          options.attributeFilter && options.attributeFilter.length &&
              !options.attributes ||

          // 1.4
          options.characterDataOldValue && !options.characterData) {

        throw new SyntaxError();
      }

      var registrations = registrationsTable.get(target);
      if (!registrations)
        registrationsTable.set(target, registrations = []);

      // 2
      // If target's list of registered observers already includes a registered
      // observer associated with the context object, replace that registered
      // observer's options with options.
      var registration;
      for (var i = 0; i < registrations.length; i++) {
        if (registrations[i].observer === this) {
          registration = registrations[i];
          registration.removeListeners();
          registration.options = options;
          break;
        }
      }

      // 3.
      // Otherwise, add a new registered observer to target's list of registered
      // observers with the context object as the observer and options as the
      // options, and add target to context object's list of nodes on which it
      // is registered.
      if (!registration) {
        registration = new Registration(this, target, options);
        registrations.push(registration);
        this.nodes_.push(target);
      }

      registration.addListeners();
    },

    disconnect: function() {
      this.nodes_.forEach(function(node) {
        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          var registration = registrations[i];
          if (registration.observer === this) {
            registration.removeListeners();
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
      this.records_ = [];
    },

    takeRecords: function() {
      var copyOfRecords = this.records_;
      this.records_ = [];
      return copyOfRecords;
    }
  };

  /**
   * @param {string} type
   * @param {Node} target
   * @constructor
   */
  function MutationRecord(type, target) {
    this.type = type;
    this.target = target;
    this.addedNodes = [];
    this.removedNodes = [];
    this.previousSibling = null;
    this.nextSibling = null;
    this.attributeName = null;
    this.attributeNamespace = null;
    this.oldValue = null;
  }

  function copyMutationRecord(original) {
    var record = new MutationRecord(original.type, original.target);
    record.addedNodes = original.addedNodes.slice();
    record.removedNodes = original.removedNodes.slice();
    record.previousSibling = original.previousSibling;
    record.nextSibling = original.nextSibling;
    record.attributeName = original.attributeName;
    record.attributeNamespace = original.attributeNamespace;
    record.oldValue = original.oldValue;
    return record;
  };

  // We keep track of the two (possibly one) records used in a single mutation.
  var currentRecord, recordWithOldValue;

  /**
   * Creates a record without |oldValue| and caches it as |currentRecord| for
   * later use.
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecord(type, target) {
    return currentRecord = new MutationRecord(type, target);
  }

  /**
   * Gets or creates a record with |oldValue| based in the |currentRecord|
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecordWithOldValue(oldValue) {
    if (recordWithOldValue)
      return recordWithOldValue;
    recordWithOldValue = copyMutationRecord(currentRecord);
    recordWithOldValue.oldValue = oldValue;
    return recordWithOldValue;
  }

  function clearRecords() {
    currentRecord = recordWithOldValue = undefined;
  }

  /**
   * @param {MutationRecord} record
   * @return {boolean} Whether the record represents a record from the current
   * mutation event.
   */
  function recordRepresentsCurrentMutation(record) {
    return record === recordWithOldValue || record === currentRecord;
  }

  /**
   * Selects which record, if any, to replace the last record in the queue.
   * This returns |null| if no record should be replaced.
   *
   * @param {MutationRecord} lastRecord
   * @param {MutationRecord} newRecord
   * @param {MutationRecord}
   */
  function selectRecord(lastRecord, newRecord) {
    if (lastRecord === newRecord)
      return lastRecord;

    // Check if the the record we are adding represents the same record. If
    // so, we keep the one with the oldValue in it.
    if (recordWithOldValue && recordRepresentsCurrentMutation(lastRecord))
      return recordWithOldValue;

    return null;
  }

  /**
   * Class used to represent a registered observer.
   * @param {MutationObserver} observer
   * @param {Node} target
   * @param {MutationObserverInit} options
   * @constructor
   */
  function Registration(observer, target, options) {
    this.observer = observer;
    this.target = target;
    this.options = options;
    this.transientObservedNodes = [];
  }

  Registration.prototype = {
    enqueue: function(record) {
      var records = this.observer.records_;
      var length = records.length;

      // There are cases where we replace the last record with the new record.
      // For example if the record represents the same mutation we need to use
      // the one with the oldValue. If we get same record (this can happen as we
      // walk up the tree) we ignore the new record.
      if (records.length > 0) {
        var lastRecord = records[length - 1];
        var recordToReplaceLast = selectRecord(lastRecord, record);
        if (recordToReplaceLast) {
          records[length - 1] = recordToReplaceLast;
          return;
        }
      } else {
        scheduleCallback(this.observer);
      }

      records[length] = record;
    },

    addListeners: function() {
      this.addListeners_(this.target);
    },

    addListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.addEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.addEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.addEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.addEventListener('DOMNodeRemoved', this, true);
    },

    removeListeners: function() {
      this.removeListeners_(this.target);
    },

    removeListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.removeEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.removeEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.removeEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.removeEventListener('DOMNodeRemoved', this, true);
    },

    /**
     * Adds a transient observer on node. The transient observer gets removed
     * next time we deliver the change records.
     * @param {Node} node
     */
    addTransientObserver: function(node) {
      // Don't add transient observers on the target itself. We already have all
      // the required listeners set up on the target.
      if (node === this.target)
        return;

      this.addListeners_(node);
      this.transientObservedNodes.push(node);
      var registrations = registrationsTable.get(node);
      if (!registrations)
        registrationsTable.set(node, registrations = []);

      // We know that registrations does not contain this because we already
      // checked if node === this.target.
      registrations.push(this);
    },

    removeTransientObservers: function() {
      var transientObservedNodes = this.transientObservedNodes;
      this.transientObservedNodes = [];

      transientObservedNodes.forEach(function(node) {
        // Transient observers are never added to the target.
        this.removeListeners_(node);

        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          if (registrations[i] === this) {
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
    },

    handleEvent: function(e) {
      // Stop propagation since we are managing the propagation manually.
      // This means that other mutation events on the page will not work
      // correctly but that is by design.
      e.stopImmediatePropagation();

      switch (e.type) {
        case 'DOMAttrModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-attributes

          var name = e.attrName;
          var namespace = e.relatedNode.namespaceURI;
          var target = e.target;

          // 1.
          var record = new getRecord('attributes', target);
          record.attributeName = name;
          record.attributeNamespace = namespace;

          // 2.
          var oldValue =
              e.attrChange === MutationEvent.ADDITION ? null : e.prevValue;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.attributes)
              return;

            // 3.2, 4.3
            if (options.attributeFilter && options.attributeFilter.length &&
                options.attributeFilter.indexOf(name) === -1 &&
                options.attributeFilter.indexOf(namespace) === -1) {
              return;
            }
            // 3.3, 4.4
            if (options.attributeOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.4, 4.5
            return record;
          });

          break;

        case 'DOMCharacterDataModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-characterdata
          var target = e.target;

          // 1.
          var record = getRecord('characterData', target);

          // 2.
          var oldValue = e.prevValue;


          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.characterData)
              return;

            // 3.2, 4.3
            if (options.characterDataOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.3, 4.4
            return record;
          });

          break;

        case 'DOMNodeRemoved':
          this.addTransientObserver(e.target);
          // Fall through.
        case 'DOMNodeInserted':
          // http://dom.spec.whatwg.org/#concept-mo-queue-childlist
          var target = e.relatedNode;
          var changedNode = e.target;
          var addedNodes, removedNodes;
          if (e.type === 'DOMNodeInserted') {
            addedNodes = [changedNode];
            removedNodes = [];
          } else {

            addedNodes = [];
            removedNodes = [changedNode];
          }
          var previousSibling = changedNode.previousSibling;
          var nextSibling = changedNode.nextSibling;

          // 1.
          var record = getRecord('childList', target);
          record.addedNodes = addedNodes;
          record.removedNodes = removedNodes;
          record.previousSibling = previousSibling;
          record.nextSibling = nextSibling;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 2.1, 3.2
            if (!options.childList)
              return;

            // 2.2, 3.3
            return record;
          });

      }

      clearRecords();
    }
  };

  global.JsMutationObserver = JsMutationObserver;

  if (!global.MutationObserver)
    global.MutationObserver = JsMutationObserver;


})(this);

// DOMTokenList polyfill for IE9
(function () {

if (typeof window.Element === "undefined" || "classList" in document.documentElement) return;

var prototype = Array.prototype,
    indexOf = prototype.indexOf,
    slice = prototype.slice,
    push = prototype.push,
    splice = prototype.splice,
    join = prototype.join;

function DOMTokenList(el) {
  this._element = el;
  if (el.className != this._classCache) {
    this._classCache = el.className;

    if (!this._classCache) return;

      // The className needs to be trimmed and split on whitespace
      // to retrieve a list of classes.
      var classes = this._classCache.replace(/^\s+|\s+$/g,'').split(/\s+/),
        i;
    for (i = 0; i < classes.length; i++) {
      push.call(this, classes[i]);
    }
  }
};

function setToClassName(el, classes) {
  el.className = classes.join(' ');
}

DOMTokenList.prototype = {
  add: function(token) {
    if(this.contains(token)) return;
    push.call(this, token);
    setToClassName(this._element, slice.call(this, 0));
  },
  contains: function(token) {
    return indexOf.call(this, token) !== -1;
  },
  item: function(index) {
    return this[index] || null;
  },
  remove: function(token) {
    var i = indexOf.call(this, token);
     if (i === -1) {
       return;
     }
    splice.call(this, i, 1);
    setToClassName(this._element, slice.call(this, 0));
  },
  toString: function() {
    return join.call(this, ' ');
  },
  toggle: function(token) {
    if (indexOf.call(this, token) === -1) {
      this.add(token);
    } else {
      this.remove(token);
    }
  }
};

window.DOMTokenList = DOMTokenList;

function defineElementGetter (obj, prop, getter) {
  if (Object.defineProperty) {
    Object.defineProperty(obj, prop,{
      get : getter
    })
  } else {
    obj.__defineGetter__(prop, getter);
  }
}

defineElementGetter(Element.prototype, 'classList', function () {
  return new DOMTokenList(this);
});

})();


if(!window.CustomElements){
	window.CustomElements = {flags:{}};
}


 /*
Copyright 2013 The Polymer Authors. All rights reserved.
Use of this source code is governed by a BSD-style
license that can be found in the LICENSE file.
*/

(function(scope){

var logFlags = window.logFlags || {};
var IMPORT_LINK_TYPE = window.HTMLImports ? HTMLImports.IMPORT_LINK_TYPE : 'none';

// walk the subtree rooted at node, applying 'find(element, data)' function
// to each element
// if 'find' returns true for 'element', do not search element's subtree
function findAll(node, find, data) {
  var e = node.firstElementChild;
  if (!e) {
    e = node.firstChild;
    while (e && e.nodeType !== Node.ELEMENT_NODE) {
      e = e.nextSibling;
    }
  }
  while (e) {
    if (find(e, data) !== true) {
      findAll(e, find, data);
    }
    e = e.nextElementSibling;
  }
  return null;
}

// walk all shadowRoots on a given node.
function forRoots(node, cb) {
  var root = node.shadowRoot;
  while(root) {
    forSubtree(root, cb);
    root = root.olderShadowRoot;
  }
}

// walk the subtree rooted at node, including descent into shadow-roots,
// applying 'cb' to each element
function forSubtree(node, cb) {
  //logFlags.dom && node.childNodes && node.childNodes.length && console.group('subTree: ', node);
  findAll(node, function(e) {
    if (cb(e)) {
      return true;
    }
    forRoots(e, cb);
  });
  forRoots(node, cb);
  //logFlags.dom && node.childNodes && node.childNodes.length && console.groupEnd();
}

// manage lifecycle on added node
function added(node) {
  if (upgrade(node)) {
    insertedNode(node);
    return true;
  }
  inserted(node);
}

// manage lifecycle on added node's subtree only
function addedSubtree(node) {
  forSubtree(node, function(e) {
    if (added(e)) {
      return true;
    }
  });
}

// manage lifecycle on added node and it's subtree
function addedNode(node) {
  return added(node) || addedSubtree(node);
}

// upgrade custom elements at node, if applicable
function upgrade(node) {
  if (!node.__upgraded__ && node.nodeType === Node.ELEMENT_NODE) {
    var type = node.getAttribute('is') || node.localName;
    var definition = scope.registry[type];
    if (definition) {
      logFlags.dom && console.group('upgrade:', node.localName);
      scope.upgrade(node);
      logFlags.dom && console.groupEnd();
      return true;
    }
  }
}

function insertedNode(node) {
  inserted(node);
  if (inDocument(node)) {
    forSubtree(node, function(e) {
      inserted(e);
    });
  }
}

// TODO(sorvell): on platforms without MutationObserver, mutations may not be
// reliable and therefore attached/detached are not reliable.
// To make these callbacks less likely to fail, we defer all inserts and removes
// to give a chance for elements to be inserted into dom.
// This ensures attachedCallback fires for elements that are created and
// immediately added to dom.
var hasPolyfillMutations = (!window.MutationObserver ||
    (window.MutationObserver === window.JsMutationObserver));
scope.hasPolyfillMutations = hasPolyfillMutations;

var isPendingMutations = false;
var pendingMutations = [];
function deferMutation(fn) {
  pendingMutations.push(fn);
  if (!isPendingMutations) {
    isPendingMutations = true;
    var async = (window.Platform && window.Platform.endOfMicrotask) ||
        setTimeout;
    async(takeMutations);
  }
}

function takeMutations() {
  isPendingMutations = false;
  var $p = pendingMutations;
  for (var i=0, l=$p.length, p; (i<l) && (p=$p[i]); i++) {
    p();
  }
  pendingMutations = [];
}

function inserted(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _inserted(element);
    });
  } else {
    _inserted(element);
  }
}

// TODO(sjmiles): if there are descents into trees that can never have inDocument(*) true, fix this
function _inserted(element) {
  // TODO(sjmiles): it's possible we were inserted and removed in the space
  // of one microtask, in which case we won't be 'inDocument' here
  // But there are other cases where we are testing for inserted without
  // specific knowledge of mutations, and must test 'inDocument' to determine
  // whether to call inserted
  // If we can factor these cases into separate code paths we can have
  // better diagnostics.
  // TODO(sjmiles): when logging, do work on all custom elements so we can
  // track behavior even when callbacks not defined
  //console.log('inserted: ', element.localName);
  if (element.attachedCallback || element.detachedCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.group('inserted:', element.localName);
    if (inDocument(element)) {
      element.__inserted = (element.__inserted || 0) + 1;
      // if we are in a 'removed' state, bluntly adjust to an 'inserted' state
      if (element.__inserted < 1) {
        element.__inserted = 1;
      }
      // if we are 'over inserted', squelch the callback
      if (element.__inserted > 1) {
        logFlags.dom && console.warn('inserted:', element.localName,
          'insert/remove count:', element.__inserted)
      } else if (element.attachedCallback) {
        logFlags.dom && console.log('inserted:', element.localName);
        element.attachedCallback();
      }
    }
    logFlags.dom && console.groupEnd();
  }
}

function removedNode(node) {
  removed(node);
  forSubtree(node, function(e) {
    removed(e);
  });
}

function removed(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _removed(element);
    });
  } else {
    _removed(element);
  }
}

function _removed(element) {
  // TODO(sjmiles): temporary: do work on all custom elements so we can track
  // behavior even when callbacks not defined
  if (element.attachedCallback || element.detachedCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.group('removed:', element.localName);
    if (!inDocument(element)) {
      element.__inserted = (element.__inserted || 0) - 1;
      // if we are in a 'inserted' state, bluntly adjust to an 'removed' state
      if (element.__inserted > 0) {
        element.__inserted = 0;
      }
      // if we are 'over removed', squelch the callback
      if (element.__inserted < 0) {
        logFlags.dom && console.warn('removed:', element.localName,
            'insert/remove count:', element.__inserted)
      } else if (element.detachedCallback) {
        element.detachedCallback();
      }
    }
    logFlags.dom && console.groupEnd();
  }
}

// SD polyfill intrustion due mainly to the fact that 'document'
// is not entirely wrapped
function wrapIfNeeded(node) {
  return window.ShadowDOMPolyfill ? ShadowDOMPolyfill.wrapIfNeeded(node)
      : node;
}

function inDocument(element) {
  var p = element;
  var doc = wrapIfNeeded(document);
  while (p) {
    if (p == doc) {
      return true;
    }
    p = p.parentNode || p.host;
  }
}

function watchShadow(node) {
  if (node.shadowRoot && !node.shadowRoot.__watched) {
    logFlags.dom && console.log('watching shadow-root for: ', node.localName);
    // watch all unwatched roots...
    var root = node.shadowRoot;
    while (root) {
      watchRoot(root);
      root = root.olderShadowRoot;
    }
  }
}

function watchRoot(root) {
  if (!root.__watched) {
    observe(root);
    root.__watched = true;
  }
}

function handler(mutations) {
  //
  if (logFlags.dom) {
    var mx = mutations[0];
    if (mx && mx.type === 'childList' && mx.addedNodes) {
        if (mx.addedNodes) {
          var d = mx.addedNodes[0];
          while (d && d !== document && !d.host) {
            d = d.parentNode;
          }
          var u = d && (d.URL || d._URL || (d.host && d.host.localName)) || '';
          u = u.split('/?').shift().split('/').pop();
        }
    }
    console.group('mutations (%d) [%s]', mutations.length, u || '');
  }
  //
  mutations.forEach(function(mx) {
    //logFlags.dom && console.group('mutation');
    if (mx.type === 'childList') {
      forEach(mx.addedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (!n.localName) {
          return;
        }
        // nodes added may need lifecycle management
        addedNode(n);
      });
      // removed nodes may need lifecycle management
      forEach(mx.removedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (!n.localName) {
          return;
        }
        removedNode(n);
      });
    }
    //logFlags.dom && console.groupEnd();
  });
  logFlags.dom && console.groupEnd();
};

var observer = new MutationObserver(handler);

function takeRecords() {
  // TODO(sjmiles): ask Raf why we have to call handler ourselves
  handler(observer.takeRecords());
  takeMutations();
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

function observe(inRoot) {
  observer.observe(inRoot, {childList: true, subtree: true});
}

function observeDocument(doc) {
  observe(doc);
}

function upgradeDocument(doc) {
  logFlags.dom && console.group('upgradeDocument: ', (doc.baseURI).split('/').pop());
  addedNode(doc);
  logFlags.dom && console.groupEnd();
}

function upgradeDocumentTree(doc) {
  doc = wrapIfNeeded(doc);
  //console.log('upgradeDocumentTree: ', (doc.baseURI).split('/').pop());
  // upgrade contained imported documents
  var imports = doc.querySelectorAll('link[rel=' + IMPORT_LINK_TYPE + ']');
  for (var i=0, l=imports.length, n; (i<l) && (n=imports[i]); i++) {
    if (n.import && n.import.__parsed) {
      upgradeDocumentTree(n.import);
    }
  }
  upgradeDocument(doc);
}

// exports
scope.IMPORT_LINK_TYPE = IMPORT_LINK_TYPE;
scope.watchShadow = watchShadow;
scope.upgradeDocumentTree = upgradeDocumentTree;
scope.upgradeAll = addedNode;
scope.upgradeSubtree = addedSubtree;
scope.insertedNode = insertedNode;

scope.observeDocument = observeDocument;
scope.upgradeDocument = upgradeDocument;

scope.takeRecords = takeRecords;

})(window.CustomElements);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

/**
 * Implements `document.register`
 * @module CustomElements
*/

/**
 * Polyfilled extensions to the `document` object.
 * @class Document
*/

(function(scope) {

// imports

if (!scope) {
  scope = window.CustomElements = {flags:{}};
}
var flags = scope.flags;

// native document.registerElement?

var hasNative = Boolean(document.registerElement);
// TODO(sorvell): See https://github.com/Polymer/polymer/issues/399
// we'll address this by defaulting to CE polyfill in the presence of the SD
// polyfill. This will avoid spamming excess attached/detached callbacks.
// If there is a compelling need to run CE native with SD polyfill,
// we'll need to fix this issue.
var useNative = !flags.register && hasNative && !window.ShadowDOMPolyfill;

if (useNative) {

  // stub
  var nop = function() {};

  // exports
  scope.registry = {};
  scope.upgradeElement = nop;

  scope.watchShadow = nop;
  scope.upgrade = nop;
  scope.upgradeAll = nop;
  scope.upgradeSubtree = nop;
  scope.observeDocument = nop;
  scope.upgradeDocument = nop;
  scope.upgradeDocumentTree = nop;
  scope.takeRecords = nop;
  scope.reservedTagList = [];

} else {

  /**
   * Registers a custom tag name with the document.
   *
   * When a registered element is created, a `readyCallback` method is called
   * in the scope of the element. The `readyCallback` method can be specified on
   * either `options.prototype` or `options.lifecycle` with the latter taking
   * precedence.
   *
   * @method register
   * @param {String} name The tag name to register. Must include a dash ('-'),
   *    for example 'x-component'.
   * @param {Object} options
   *    @param {String} [options.extends]
   *      (_off spec_) Tag name of an element to extend (or blank for a new
   *      element). This parameter is not part of the specification, but instead
   *      is a hint for the polyfill because the extendee is difficult to infer.
   *      Remember that the input prototype must chain to the extended element's
   *      prototype (or HTMLElement.prototype) regardless of the value of
   *      `extends`.
   *    @param {Object} options.prototype The prototype to use for the new
   *      element. The prototype must inherit from HTMLElement.
   *    @param {Object} [options.lifecycle]
   *      Callbacks that fire at important phases in the life of the custom
   *      element.
   *
   * @example
   *      FancyButton = document.registerElement("fancy-button", {
   *        extends: 'button',
   *        prototype: Object.create(HTMLButtonElement.prototype, {
   *          readyCallback: {
   *            value: function() {
   *              console.log("a fancy-button was created",
   *            }
   *          }
   *        })
   *      });
   * @return {Function} Constructor for the newly registered type.
   */
  function register(name, options) {
    //console.warn('document.registerElement("' + name + '", ', options, ')');
    // construct a defintion out of options
    // TODO(sjmiles): probably should clone options instead of mutating it
    var definition = options || {};
    if (!name) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.registerElement: first argument `name` must not be empty');
    }
    if (name.indexOf('-') < 0) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.registerElement: first argument (\'name\') must contain a dash (\'-\'). Argument provided was \'' + String(name) + '\'.');
    }
    // prevent registering reserved names
    if (isReservedTag(name)) {
      throw new Error('Failed to execute \'registerElement\' on \'Document\': Registration failed for type \'' + String(name) + '\'. The type name is invalid.');
    }
    // elements may only be registered once
    if (getRegisteredDefinition(name)) {
      throw new Error('DuplicateDefinitionError: a type with name \'' + String(name) + '\' is already registered');
    }
    // must have a prototype, default to an extension of HTMLElement
    // TODO(sjmiles): probably should throw if no prototype, check spec
    if (!definition.prototype) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('Options missing required prototype property');
    }
    // record name
    definition.__name = name.toLowerCase();
    // ensure a lifecycle object so we don't have to null test it
    definition.lifecycle = definition.lifecycle || {};
    // build a list of ancestral custom elements (for native base detection)
    // TODO(sjmiles): we used to need to store this, but current code only
    // uses it in 'resolveTagName': it should probably be inlined
    definition.ancestry = ancestry(definition.extends);
    // extensions of native specializations of HTMLElement require localName
    // to remain native, and use secondary 'is' specifier for extension type
    resolveTagName(definition);
    // some platforms require modifications to the user-supplied prototype
    // chain
    resolvePrototypeChain(definition);
    // overrides to implement attributeChanged callback
    overrideAttributeApi(definition.prototype);
    // 7.1.5: Register the DEFINITION with DOCUMENT
    registerDefinition(definition.__name, definition);
    // 7.1.7. Run custom element constructor generation algorithm with PROTOTYPE
    // 7.1.8. Return the output of the previous step.
    definition.ctor = generateConstructor(definition);
    definition.ctor.prototype = definition.prototype;
    // force our .constructor to be our actual constructor
    definition.prototype.constructor = definition.ctor;
    // if initial parsing is complete
    if (scope.ready) {
      // upgrade any pre-existing nodes of this type
      scope.upgradeDocumentTree(document);
    }
    return definition.ctor;
  }

  function isReservedTag(name) {
    for (var i = 0; i < reservedTagList.length; i++) {
      if (name === reservedTagList[i]) {
        return true;
      }
    }
  }

  var reservedTagList = [
    'annotation-xml', 'color-profile', 'font-face', 'font-face-src',
    'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'
  ];

  function ancestry(extnds) {
    var extendee = getRegisteredDefinition(extnds);
    if (extendee) {
      return ancestry(extendee.extends).concat([extendee]);
    }
    return [];
  }

  function resolveTagName(definition) {
    // if we are explicitly extending something, that thing is our
    // baseTag, unless it represents a custom component
    var baseTag = definition.extends;
    // if our ancestry includes custom components, we only have a
    // baseTag if one of them does
    for (var i=0, a; (a=definition.ancestry[i]); i++) {
      baseTag = a.is && a.tag;
    }
    // our tag is our baseTag, if it exists, and otherwise just our name
    definition.tag = baseTag || definition.__name;
    if (baseTag) {
      // if there is a base tag, use secondary 'is' specifier
      definition.is = definition.__name;
    }
  }

  function resolvePrototypeChain(definition) {
    // if we don't support __proto__ we need to locate the native level
    // prototype for precise mixing in
    if (!Object.__proto__) {
      // default prototype
      var nativePrototype = HTMLElement.prototype;
      // work out prototype when using type-extension
      if (definition.is) {
        var inst = document.createElement(definition.tag);
        nativePrototype = Object.getPrototypeOf(inst);
      }
      // ensure __proto__ reference is installed at each point on the prototype
      // chain.
      // NOTE: On platforms without __proto__, a mixin strategy is used instead
      // of prototype swizzling. In this case, this generated __proto__ provides
      // limited support for prototype traversal.
      var proto = definition.prototype, ancestor;
      while (proto && (proto !== nativePrototype)) {
        var ancestor = Object.getPrototypeOf(proto);
        proto.__proto__ = ancestor;
        proto = ancestor;
      }
    }
    // cache this in case of mixin
    definition.native = nativePrototype;
  }

  // SECTION 4

  function instantiate(definition) {
    // 4.a.1. Create a new object that implements PROTOTYPE
    // 4.a.2. Let ELEMENT by this new object
    //
    // the custom element instantiation algorithm must also ensure that the
    // output is a valid DOM element with the proper wrapper in place.
    //
    return upgrade(domCreateElement(definition.tag), definition);
  }

  function upgrade(element, definition) {
    // some definitions specify an 'is' attribute
    if (definition.is) {
      element.setAttribute('is', definition.is);
    }
    // remove 'unresolved' attr, which is a standin for :unresolved.
    element.removeAttribute('unresolved');
    // make 'element' implement definition.prototype
    implement(element, definition);
    // flag as upgraded
    element.__upgraded__ = true;
    // lifecycle management
    created(element);
    // attachedCallback fires in tree order, call before recursing
    scope.insertedNode(element);
    // there should never be a shadow root on element at this point
    scope.upgradeSubtree(element);
    // OUTPUT
    return element;
  }

  function implement(element, definition) {
    // prototype swizzling is best
    if (Object.__proto__) {
      element.__proto__ = definition.prototype;
    } else {
      // where above we can re-acquire inPrototype via
      // getPrototypeOf(Element), we cannot do so when
      // we use mixin, so we install a magic reference
      customMixin(element, definition.prototype, definition.native);
      element.__proto__ = definition.prototype;
    }
  }

  function customMixin(inTarget, inSrc, inNative) {
    // TODO(sjmiles): 'used' allows us to only copy the 'youngest' version of
    // any property. This set should be precalculated. We also need to
    // consider this for supporting 'super'.
    var used = {};
    // start with inSrc
    var p = inSrc;
    // The default is HTMLElement.prototype, so we add a test to avoid mixing in
    // native prototypes
    while (p !== inNative && p !== HTMLElement.prototype) {
      var keys = Object.getOwnPropertyNames(p);
      for (var i=0, k; k=keys[i]; i++) {
        if (!used[k]) {
          Object.defineProperty(inTarget, k,
              Object.getOwnPropertyDescriptor(p, k));
          used[k] = 1;
        }
      }
      p = Object.getPrototypeOf(p);
    }
  }

  function created(element) {
    // invoke createdCallback
    if (element.createdCallback) {
      element.createdCallback();
    }
  }

  // attribute watching

  function overrideAttributeApi(prototype) {
    // overrides to implement callbacks
    // TODO(sjmiles): should support access via .attributes NamedNodeMap
    // TODO(sjmiles): preserves user defined overrides, if any
    if (prototype.setAttribute._polyfilled) {
      return;
    }
    var setAttribute = prototype.setAttribute;
    prototype.setAttribute = function(name, value) {
      changeAttribute.call(this, name, value, setAttribute);
    }
    var removeAttribute = prototype.removeAttribute;
    prototype.removeAttribute = function(name) {
      changeAttribute.call(this, name, null, removeAttribute);
    }
    prototype.setAttribute._polyfilled = true;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/custom/
  // index.html#dfn-attribute-changed-callback
  function changeAttribute(name, value, operation) {
    var oldValue = this.getAttribute(name);
    operation.apply(this, arguments);
    var newValue = this.getAttribute(name);
    if (this.attributeChangedCallback
        && (newValue !== oldValue)) {
      this.attributeChangedCallback(name, oldValue, newValue);
    }
  }

  // element registry (maps tag names to definitions)

  var registry = {};

  function getRegisteredDefinition(name) {
    if (name) {
      return registry[name.toLowerCase()];
    }
  }

  function registerDefinition(name, definition) {
    registry[name] = definition;
  }

  function generateConstructor(definition) {
    return function() {
      return instantiate(definition);
    };
  }

  var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
  function createElementNS(namespace, tag, typeExtension) {
    // NOTE: we do not support non-HTML elements,
    // just call createElementNS for non HTML Elements
    if (namespace === HTML_NAMESPACE) {
      return createElement(tag, typeExtension);
    } else {
      return domCreateElementNS(namespace, tag);
    }
  }

  function createElement(tag, typeExtension) {
    // TODO(sjmiles): ignore 'tag' when using 'typeExtension', we could
    // error check it, or perhaps there should only ever be one argument
    var definition = getRegisteredDefinition(typeExtension || tag);
    if (definition) {
      if (tag == definition.tag && typeExtension == definition.is) {
        return new definition.ctor();
      }
      // Handle empty string for type extension.
      if (!typeExtension && !definition.is) {
        return new definition.ctor();
      }
    }

    if (typeExtension) {
      var element = createElement(tag);
      element.setAttribute('is', typeExtension);
      return element;
    }
    var element = domCreateElement(tag);
    // Custom tags should be HTMLElements even if not upgraded.
    if (tag.indexOf('-') >= 0) {
      implement(element, HTMLElement);
    }
    return element;
  }

  function upgradeElement(element) {
    if (!element.__upgraded__ && (element.nodeType === Node.ELEMENT_NODE)) {
      var is = element.getAttribute('is');
      var definition = getRegisteredDefinition(is || element.localName);
      if (definition) {
        if (is && definition.tag == element.localName) {
          return upgrade(element, definition);
        } else if (!is && !definition.extends) {
          return upgrade(element, definition);
        }
      }
    }
  }

  function cloneNode(deep) {
    // call original clone
    var n = domCloneNode.call(this, deep);
    // upgrade the element and subtree
    scope.upgradeAll(n);
    // return the clone
    return n;
  }
  // capture native createElement before we override it

  var domCreateElement = document.createElement.bind(document);
  var domCreateElementNS = document.createElementNS.bind(document);

  // capture native cloneNode before we override it

  var domCloneNode = Node.prototype.cloneNode;

  // exports

  document.registerElement = register;
  document.createElement = createElement; // override
  document.createElementNS = createElementNS; // override
  Node.prototype.cloneNode = cloneNode; // override

  scope.registry = registry;

  /**
   * Upgrade an element to a custom element. Upgrading an element
   * causes the custom prototype to be applied, an `is` attribute
   * to be attached (as needed), and invocation of the `readyCallback`.
   * `upgrade` does nothing if the element is already upgraded, or
   * if it matches no registered custom tag name.
   *
   * @method ugprade
   * @param {Element} element The element to upgrade.
   * @return {Element} The upgraded element.
   */
  scope.upgrade = upgradeElement;
}

// Create a custom 'instanceof'. This is necessary when CustomElements
// are implemented via a mixin strategy, as for example on IE10.
var isInstance;
if (!Object.__proto__ && !useNative) {
  isInstance = function(obj, ctor) {
    var p = obj;
    while (p) {
      // NOTE: this is not technically correct since we're not checking if
      // an object is an instance of a constructor; however, this should
      // be good enough for the mixin strategy.
      if (p === ctor.prototype) {
        return true;
      }
      p = p.__proto__;
    }
    return false;
  }
} else {
  isInstance = function(obj, base) {
    return obj instanceof base;
  }
}

// exports
scope.instanceof = isInstance;
scope.reservedTagList = reservedTagList;

// bc
document.register = document.registerElement;

scope.hasNative = hasNative;
scope.useNative = useNative;

})(window.CustomElements);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

// import

var IMPORT_LINK_TYPE = scope.IMPORT_LINK_TYPE;

// highlander object for parsing a document tree

var parser = {
  selectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']'
  ],
  map: {
    link: 'parseLink'
  },
  parse: function(inDocument) {
    if (!inDocument.__parsed) {
      // only parse once
      inDocument.__parsed = true;
      // all parsable elements in inDocument (depth-first pre-order traversal)
      var elts = inDocument.querySelectorAll(parser.selectors);
      // for each parsable node type, call the mapped parsing method
      forEach(elts, function(e) {
        parser[parser.map[e.localName]](e);
      });
      // upgrade all upgradeable static elements, anything dynamically
      // created should be caught by observer
      CustomElements.upgradeDocument(inDocument);
      // observe document for dom changes
      CustomElements.observeDocument(inDocument);
    }
  },
  parseLink: function(linkElt) {
    // imports
    if (isDocumentLink(linkElt)) {
      this.parseImport(linkElt);
    }
  },
  parseImport: function(linkElt) {
    if (linkElt.import) {
      parser.parse(linkElt.import);
    }
  }
};

function isDocumentLink(inElt) {
  return (inElt.localName === 'link'
      && inElt.getAttribute('rel') === IMPORT_LINK_TYPE);
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

// exports

scope.parser = parser;
scope.IMPORT_LINK_TYPE = IMPORT_LINK_TYPE;

})(window.CustomElements);
/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
(function(scope){

// bootstrap parsing
function bootstrap() {
  // parse document
  CustomElements.parser.parse(document);
  // one more pass before register is 'live'
  CustomElements.upgradeDocument(document);
  // choose async
  var async = window.Platform && Platform.endOfMicrotask ?
    Platform.endOfMicrotask :
    setTimeout;
  async(function() {
    // set internal 'ready' flag, now document.registerElement will trigger
    // synchronous upgrades
    CustomElements.ready = true;
    // capture blunt profiling data
    CustomElements.readyTime = Date.now();
    if (window.HTMLImports) {
      CustomElements.elapsed = CustomElements.readyTime - HTMLImports.readyTime;
    }
    // notify the system that we are bootstrapped
    document.dispatchEvent(
      new CustomEvent('WebComponentsReady', {bubbles: true})
    );

    // install upgrade hook if HTMLImports are available
    if (window.HTMLImports) {
      HTMLImports.__importsParsingHook = function(elt) {
        CustomElements.parser.parse(elt.import);
      }
    }
  });
}

// CustomEvent shim for IE
if (typeof window.CustomEvent !== 'function') {
  window.CustomEvent = function(inType) {
    var e = document.createEvent('HTMLEvents');
    e.initEvent(inType, true, true);
    return e;
  };
}

// When loading at readyState complete time (or via flag), boot custom elements
// immediately.
// If relevant, HTMLImports must already be loaded.
if (document.readyState === 'complete' || scope.flags.eager) {
  bootstrap();
// When loading at readyState interactive time, bootstrap only if HTMLImports
// are not pending. Also avoid IE as the semantics of this state are unreliable.
} else if (document.readyState === 'interactive' && !window.attachEvent &&
    (!window.HTMLImports || window.HTMLImports.ready)) {
  bootstrap();
// When loading at other readyStates, wait for the appropriate DOM event to
// bootstrap.
} else {
  var loadEvent = window.HTMLImports && !HTMLImports.ready ?
      'HTMLImportsLoaded' : 'DOMContentLoaded';
  window.addEventListener(loadEvent, bootstrap);
}

})(window.CustomElements);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
window.HTMLImports = window.HTMLImports || {flags:{}};
/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

  // imports
  var path = scope.path;
  var xhr = scope.xhr;
  var flags = scope.flags;

  // TODO(sorvell): this loader supports a dynamic list of urls
  // and an oncomplete callback that is called when the loader is done.
  // The polyfill currently does *not* need this dynamism or the onComplete
  // concept. Because of this, the loader could be simplified quite a bit.
  var Loader = function(onLoad, onComplete) {
    this.cache = {};
    this.onload = onLoad;
    this.oncomplete = onComplete;
    this.inflight = 0;
    this.pending = {};
  };

  Loader.prototype = {
    addNodes: function(nodes) {
      // number of transactions to complete
      this.inflight += nodes.length;
      // commence transactions
      for (var i=0, l=nodes.length, n; (i<l) && (n=nodes[i]); i++) {
        this.require(n);
      }
      // anything to do?
      this.checkDone();
    },
    addNode: function(node) {
      // number of transactions to complete
      this.inflight++;
      // commence transactions
      this.require(node);
      // anything to do?
      this.checkDone();
    },
    require: function(elt) {
      var url = elt.src || elt.href;
      // ensure we have a standard url that can be used
      // reliably for deduping.
      // TODO(sjmiles): ad-hoc
      elt.__nodeUrl = url;
      // deduplication
      if (!this.dedupe(url, elt)) {
        // fetch this resource
        this.fetch(url, elt);
      }
    },
    dedupe: function(url, elt) {
      if (this.pending[url]) {
        // add to list of nodes waiting for inUrl
        this.pending[url].push(elt);
        // don't need fetch
        return true;
      }
      var resource;
      if (this.cache[url]) {
        this.onload(url, elt, this.cache[url]);
        // finished this transaction
        this.tail();
        // don't need fetch
        return true;
      }
      // first node waiting for inUrl
      this.pending[url] = [elt];
      // need fetch (not a dupe)
      return false;
    },
    fetch: function(url, elt) {
      flags.load && console.log('fetch', url, elt);
      if (url.match(/^data:/)) {
        // Handle Data URI Scheme
        var pieces = url.split(',');
        var header = pieces[0];
        var body = pieces[1];
        if(header.indexOf(';base64') > -1) {
          body = atob(body);
        } else {
          body = decodeURIComponent(body);
        }
        setTimeout(function() {
            this.receive(url, elt, null, body);
        }.bind(this), 0);
      } else {
        var receiveXhr = function(err, resource) {
          this.receive(url, elt, err, resource);
        }.bind(this);
        xhr.load(url, receiveXhr);
        // TODO(sorvell): blocked on)
        // https://code.google.com/p/chromium/issues/detail?id=257221
        // xhr'ing for a document makes scripts in imports runnable; otherwise
        // they are not; however, it requires that we have doctype=html in
        // the import which is unacceptable. This is only needed on Chrome
        // to avoid the bug above.
        /*
        if (isDocumentLink(elt)) {
          xhr.loadDocument(url, receiveXhr);
        } else {
          xhr.load(url, receiveXhr);
        }
        */
      }
    },
    receive: function(url, elt, err, resource) {
      this.cache[url] = resource;
      var $p = this.pending[url];
      for (var i=0, l=$p.length, p; (i<l) && (p=$p[i]); i++) {
        //if (!err) {
          this.onload(url, p, resource);
        //}
        this.tail();
      }
      this.pending[url] = null;
    },
    tail: function() {
      --this.inflight;
      this.checkDone();
    },
    checkDone: function() {
      if (!this.inflight) {
        this.oncomplete();
      }
    }
  };

  xhr = xhr || {
    async: true,
    ok: function(request) {
      return (request.status >= 200 && request.status < 300)
          || (request.status === 304)
          || (request.status === 0);
    },
    load: function(url, next, nextContext) {
      var request = new XMLHttpRequest();
      if (scope.flags.debug || scope.flags.bust) {
        url += '?' + Math.random();
      }
      request.open('GET', url, xhr.async);
      request.addEventListener('readystatechange', function(e) {
        if (request.readyState === 4) {
          next.call(nextContext, !xhr.ok(request) && request,
              request.response || request.responseText, url);
        }
      });
      request.send();
      return request;
    },
    loadDocument: function(url, next, nextContext) {
      this.load(url, next, nextContext).responseType = 'document';
    }
  };

  // exports
  scope.xhr = xhr;
  scope.Loader = Loader;

})(window.HTMLImports);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

var IMPORT_LINK_TYPE = 'import';
var flags = scope.flags;
var isIe = /Trident/.test(navigator.userAgent);
// TODO(sorvell): SD polyfill intrusion
var mainDoc = window.ShadowDOMPolyfill ?
    window.ShadowDOMPolyfill.wrapIfNeeded(document) : document;

// importParser
// highlander object to manage parsing of imports
// parses import related elements
// and ensures proper parse order
// parse order is enforced by crawling the tree and monitoring which elements
// have been parsed; async parsing is also supported.

// highlander object for parsing a document tree
var importParser = {
  // parse selectors for main document elements
  documentSelectors: 'link[rel=' + IMPORT_LINK_TYPE + ']',
  // parse selectors for import document elements
  importsSelectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']',
    'link[rel=stylesheet]',
    'style',
    'script:not([type])',
    'script[type="text/javascript"]'
  ].join(','),
  map: {
    link: 'parseLink',
    script: 'parseScript',
    style: 'parseStyle'
  },
  // try to parse the next import in the tree
  parseNext: function() {
    var next = this.nextToParse();
    if (next) {
      this.parse(next);
    }
  },
  parse: function(elt) {
    if (this.isParsed(elt)) {
      flags.parse && console.log('[%s] is already parsed', elt.localName);
      return;
    }
    var fn = this[this.map[elt.localName]];
    if (fn) {
      this.markParsing(elt);
      fn.call(this, elt);
    }
  },
  // only 1 element may be parsed at a time; parsing is async so, each
  // parsing implementation must inform the system that parsing is complete
  // via markParsingComplete.
  markParsing: function(elt) {
    flags.parse && console.log('parsing', elt);
    this.parsingElement = elt;
  },
  markParsingComplete: function(elt) {
    elt.__importParsed = true;
    if (elt.__importElement) {
      elt.__importElement.__importParsed = true;
    }
    this.parsingElement = null;
    flags.parse && console.log('completed', elt);
    this.parseNext();
  },
  parseImport: function(elt) {
    elt.import.__importParsed = true;
    // TODO(sorvell): consider if there's a better way to do this;
    // expose an imports parsing hook; this is needed, for example, by the
    // CustomElements polyfill.
    if (HTMLImports.__importsParsingHook) {
      HTMLImports.__importsParsingHook(elt);
    }
    // fire load event
    if (elt.__resource) {
      elt.dispatchEvent(new CustomEvent('load', {bubbles: false}));
    } else {
      elt.dispatchEvent(new CustomEvent('error', {bubbles: false}));
    }
    // TODO(sorvell): workaround for Safari addEventListener not working
    // for elements not in the main document.
    if (elt.__pending) {
      var fn;
      while (elt.__pending.length) {
        fn = elt.__pending.shift();
        if (fn) {
          fn({target: elt});
        }
      }
    }
    this.markParsingComplete(elt);
  },
  parseLink: function(linkElt) {
    if (nodeIsImport(linkElt)) {
      this.parseImport(linkElt);
    } else {
      // make href absolute
      linkElt.href = linkElt.href;
      this.parseGeneric(linkElt);
    }
  },
  parseStyle: function(elt) {
    // TODO(sorvell): style element load event can just not fire so clone styles
    var src = elt;
    elt = cloneStyle(elt);
    elt.__importElement = src;
    this.parseGeneric(elt);
  },
  parseGeneric: function(elt) {
    this.trackElement(elt);
    document.head.appendChild(elt);
  },
  // tracks when a loadable element has loaded
  trackElement: function(elt, callback) {
    var self = this;
    var done = function(e) {
      if (callback) {
        callback(e);
      }
      self.markParsingComplete(elt);
    };
    elt.addEventListener('load', done);
    elt.addEventListener('error', done);

    // NOTE: IE does not fire "load" event for styles that have already loaded
    // This is in violation of the spec, so we try our hardest to work around it
    if (isIe && elt.localName === 'style') {
      var fakeLoad = false;
      // If there's not @import in the textContent, assume it has loaded
      if (elt.textContent.indexOf('@import') == -1) {
        fakeLoad = true;
      // if we have a sheet, we have been parsed
      } else if (elt.sheet) {
        fakeLoad = true;
        var csr = elt.sheet.cssRules;
        var len = csr ? csr.length : 0;
        // search the rules for @import's
        for (var i = 0, r; (i < len) && (r = csr[i]); i++) {
          if (r.type === CSSRule.IMPORT_RULE) {
            // if every @import has resolved, fake the load
            fakeLoad = fakeLoad && Boolean(r.styleSheet);
          }
        }
      }
      // dispatch a fake load event and continue parsing
      if (fakeLoad) {
        elt.dispatchEvent(new CustomEvent('load', {bubbles: false}));
      }
    }
  },
  // NOTE: execute scripts by injecting them and watching for the load/error
  // event. Inline scripts are handled via dataURL's because browsers tend to
  // provide correct parsing errors in this case. If this has any compatibility
  // issues, we can switch to injecting the inline script with textContent.
  // Scripts with dataURL's do not appear to generate load events and therefore
  // we assume they execute synchronously.
  parseScript: function(scriptElt) {
    var script = document.createElement('script');
    script.__importElement = scriptElt;
    script.src = scriptElt.src ? scriptElt.src :
        generateScriptDataUrl(scriptElt);
    scope.currentScript = scriptElt;
    this.trackElement(script, function(e) {
      script.parentNode.removeChild(script);
      scope.currentScript = null;
    });
    document.head.appendChild(script);
  },
  // determine the next element in the tree which should be parsed
  nextToParse: function() {
    return !this.parsingElement && this.nextToParseInDoc(mainDoc);
  },
  nextToParseInDoc: function(doc, link) {
    var nodes = doc.querySelectorAll(this.parseSelectorsForNode(doc));
    for (var i=0, l=nodes.length, p=0, n; (i<l) && (n=nodes[i]); i++) {
      if (!this.isParsed(n)) {
        if (this.hasResource(n)) {
          return nodeIsImport(n) ? this.nextToParseInDoc(n.import, n) : n;
        } else {
          return;
        }
      }
    }
    // all nodes have been parsed, ready to parse import, if any
    return link;
  },
  // return the set of parse selectors relevant for this node.
  parseSelectorsForNode: function(node) {
    var doc = node.ownerDocument || node;
    return doc === mainDoc ? this.documentSelectors : this.importsSelectors;
  },
  isParsed: function(node) {
    return node.__importParsed;
  },
  hasResource: function(node) {
    if (nodeIsImport(node) && !node.import) {
      return false;
    }
    return true;
  }
};

function nodeIsImport(elt) {
  return (elt.localName === 'link') && (elt.rel === IMPORT_LINK_TYPE);
}

function generateScriptDataUrl(script) {
  var scriptContent = generateScriptContent(script), b64;
  try {
    b64 = btoa(scriptContent);
  } catch(e) {
    b64 = btoa(unescape(encodeURIComponent(scriptContent)));
    console.warn('Script contained non-latin characters that were forced ' +
      'to latin. Some characters may be wrong.', script);
  }
  return 'data:text/javascript;base64,' + b64;
}

function generateScriptContent(script) {
  return script.textContent + generateSourceMapHint(script);
}

// calculate source map hint
function generateSourceMapHint(script) {
  var moniker = script.__nodeUrl;
  if (!moniker) {
    moniker = script.ownerDocument.baseURI;
    // there could be more than one script this url
    var tag = '[' + Math.floor((Math.random()+1)*1000) + ']';
    // TODO(sjmiles): Polymer hack, should be pluggable if we need to allow
    // this sort of thing
    var matches = script.textContent.match(/Polymer\(['"]([^'"]*)/);
    tag = matches && matches[1] || tag;
    // tag the moniker
    moniker += '/' + tag + '.js';
  }
  return '\n//# sourceURL=' + moniker + '\n';
}

// style/stylesheet handling

// clone style with proper path resolution for main document
// NOTE: styles are the only elements that require direct path fixup.
function cloneStyle(style) {
  var clone = style.ownerDocument.createElement('style');
  clone.textContent = style.textContent;
  path.resolveUrlsInStyle(clone);
  return clone;
}

// path fixup: style elements in imports must be made relative to the main
// document. We fixup url's in url() and @import.
var CSS_URL_REGEXP = /(url\()([^)]*)(\))/g;
var CSS_IMPORT_REGEXP = /(@import[\s]+(?!url\())([^;]*)(;)/g;

var path = {
  resolveUrlsInStyle: function(style) {
    var doc = style.ownerDocument;
    var resolver = doc.createElement('a');
    style.textContent = this.resolveUrlsInCssText(style.textContent, resolver);
    return style;
  },
  resolveUrlsInCssText: function(cssText, urlObj) {
    var r = this.replaceUrls(cssText, urlObj, CSS_URL_REGEXP);
    r = this.replaceUrls(r, urlObj, CSS_IMPORT_REGEXP);
    return r;
  },
  replaceUrls: function(text, urlObj, regexp) {
    return text.replace(regexp, function(m, pre, url, post) {
      var urlPath = url.replace(/["']/g, '');
      urlObj.href = urlPath;
      urlPath = urlObj.href;
      return pre + '\'' + urlPath + '\'' + post;
    });
  }
}

// exports
scope.parser = importParser;
scope.path = path;
scope.isIE = isIe;

})(HTMLImports);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

var hasNative = ('import' in document.createElement('link'));
var useNative = hasNative;
var flags = scope.flags;
var IMPORT_LINK_TYPE = 'import';

// TODO(sorvell): SD polyfill intrusion
var mainDoc = window.ShadowDOMPolyfill ?
    ShadowDOMPolyfill.wrapIfNeeded(document) : document;

if (!useNative) {

  // imports
  var xhr = scope.xhr;
  var Loader = scope.Loader;
  var parser = scope.parser;

  // importer
  // highlander object to manage loading of imports

  // for any document, importer:
  // - loads any linked import documents (with deduping)

  var importer = {
    documents: {},
    // nodes to load in the mian document
    documentPreloadSelectors: 'link[rel=' + IMPORT_LINK_TYPE + ']',
    // nodes to load in imports
    importsPreloadSelectors: [
      'link[rel=' + IMPORT_LINK_TYPE + ']'
    ].join(','),
    loadNode: function(node) {
      importLoader.addNode(node);
    },
    // load all loadable elements within the parent element
    loadSubtree: function(parent) {
      var nodes = this.marshalNodes(parent);
      // add these nodes to loader's queue
      importLoader.addNodes(nodes);
    },
    marshalNodes: function(parent) {
      // all preloadable nodes in inDocument
      return parent.querySelectorAll(this.loadSelectorsForNode(parent));
    },
    // find the proper set of load selectors for a given node
    loadSelectorsForNode: function(node) {
      var doc = node.ownerDocument || node;
      return doc === mainDoc ? this.documentPreloadSelectors :
          this.importsPreloadSelectors;
    },
    loaded: function(url, elt, resource) {
      flags.load && console.log('loaded', url, elt);
      // store generic resource
      // TODO(sorvell): fails for nodes inside <template>.content
      // see https://code.google.com/p/chromium/issues/detail?id=249381.
      elt.__resource = resource;
      if (isDocumentLink(elt)) {
        var doc = this.documents[url];
        // if we've never seen a document at this url
        if (!doc) {
          // generate an HTMLDocument from data
          doc = makeDocument(resource, url);
          doc.__importLink = elt;
          // TODO(sorvell): we cannot use MO to detect parsed nodes because
          // SD polyfill does not report these as mutations.
          this.bootDocument(doc);
          // cache document
          this.documents[url] = doc;
        }
        // don't store import record until we're actually loaded
        // store document resource
        elt.import = doc;
      }
      parser.parseNext();
    },
    bootDocument: function(doc) {
      this.loadSubtree(doc);
      this.observe(doc);
      parser.parseNext();
    },
    loadedAll: function() {
      parser.parseNext();
    }
  };

  // loader singleton
  var importLoader = new Loader(importer.loaded.bind(importer),
      importer.loadedAll.bind(importer));

  function isDocumentLink(elt) {
    return isLinkRel(elt, IMPORT_LINK_TYPE);
  }

  function isLinkRel(elt, rel) {
    return elt.localName === 'link' && elt.getAttribute('rel') === rel;
  }

  function isScript(elt) {
    return elt.localName === 'script';
  }

  function makeDocument(resource, url) {
    // create a new HTML document
    var doc = resource;
    if (!(doc instanceof Document)) {
      doc = document.implementation.createHTMLDocument(IMPORT_LINK_TYPE);
    }
    // cache the new document's source url
    doc._URL = url;
    // establish a relative path via <base>
    var base = doc.createElement('base');
    base.setAttribute('href', url);
    // add baseURI support to browsers (IE) that lack it.
    if (!doc.baseURI) {
      doc.baseURI = url;
    }
    // ensure UTF-8 charset
    var meta = doc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');

    doc.head.appendChild(meta);
    doc.head.appendChild(base);
    // install HTML last as it may trigger CustomElement upgrades
    // TODO(sjmiles): problem wrt to template boostrapping below,
    // template bootstrapping must (?) come before element upgrade
    // but we cannot bootstrap templates until they are in a document
    // which is too late
    if (!(resource instanceof Document)) {
      // install html
      doc.body.innerHTML = resource;
    }
    // TODO(sorvell): ideally this code is not aware of Template polyfill,
    // but for now the polyfill needs help to bootstrap these templates
    if (window.HTMLTemplateElement && HTMLTemplateElement.bootstrap) {
      HTMLTemplateElement.bootstrap(doc);
    }
    return doc;
  }
} else {
  // do nothing if using native imports
  var importer = {};
}

// NOTE: We cannot polyfill document.currentScript because it's not possible
// both to override and maintain the ability to capture the native value;
// therefore we choose to expose _currentScript both when native imports
// and the polyfill are in use.
var currentScriptDescriptor = {
  get: function() {
    return HTMLImports.currentScript || document.currentScript;
  },
  configurable: true
};

Object.defineProperty(document, '_currentScript', currentScriptDescriptor);
Object.defineProperty(mainDoc, '_currentScript', currentScriptDescriptor);

// Polyfill document.baseURI for browsers without it.
if (!document.baseURI) {
  var baseURIDescriptor = {
    get: function() {
      return window.location.href;
    },
    configurable: true
  };

  Object.defineProperty(document, 'baseURI', baseURIDescriptor);
  Object.defineProperty(mainDoc, 'baseURI', baseURIDescriptor);
}

// call a callback when all HTMLImports in the document at call (or at least
//  document ready) time have loaded.
// 1. ensure the document is in a ready state (has dom), then
// 2. watch for loading of imports and call callback when done
function whenImportsReady(callback, doc) {
  doc = doc || mainDoc;
  // if document is loading, wait and try again
  whenDocumentReady(function() {
    watchImportsLoad(callback, doc);
  }, doc);
}

// call the callback when the document is in a ready state (has dom)
var requiredReadyState = HTMLImports.isIE ? 'complete' : 'interactive';
var READY_EVENT = 'readystatechange';
function isDocumentReady(doc) {
  return (doc.readyState === 'complete' ||
      doc.readyState === requiredReadyState);
}

// call <callback> when we ensure the document is in a ready state
function whenDocumentReady(callback, doc) {
  if (!isDocumentReady(doc)) {
    var checkReady = function() {
      if (doc.readyState === 'complete' ||
          doc.readyState === requiredReadyState) {
        doc.removeEventListener(READY_EVENT, checkReady);
        whenDocumentReady(callback, doc);
      }
    }
    doc.addEventListener(READY_EVENT, checkReady);
  } else if (callback) {
    callback();
  }
}

// call <callback> when we ensure all imports have loaded
function watchImportsLoad(callback, doc) {
  var imports = doc.querySelectorAll('link[rel=import]');
  var loaded = 0, l = imports.length;
  function checkDone(d) {
    if (loaded == l) {
      // go async to ensure parser isn't stuck on a script tag
      requestAnimationFrame(callback);
    }
  }
  function loadedImport(e) {
    loaded++;
    checkDone();
  }
  if (l) {
    for (var i=0, imp; (i<l) && (imp=imports[i]); i++) {
      if (isImportLoaded(imp)) {
        loadedImport.call(imp);
      } else {
        imp.addEventListener('load', loadedImport);
        imp.addEventListener('error', loadedImport);
      }
    }
  } else {
    checkDone();
  }
}

function isImportLoaded(link) {
  return useNative ? (link.import && (link.import.readyState !== 'loading')) :
      link.__importParsed;
}

// exports
scope.hasNative = hasNative;
scope.useNative = useNative;
scope.importer = importer;
scope.whenImportsReady = whenImportsReady;
scope.IMPORT_LINK_TYPE = IMPORT_LINK_TYPE;
scope.isImportLoaded = isImportLoaded;
scope.importLoader = importLoader;

})(window.HTMLImports);

 /*
Copyright 2013 The Polymer Authors. All rights reserved.
Use of this source code is governed by a BSD-style
license that can be found in the LICENSE file.
*/

(function(scope){

var IMPORT_LINK_TYPE = scope.IMPORT_LINK_TYPE;
var importSelector = 'link[rel=' + IMPORT_LINK_TYPE + ']';
var importer = scope.importer;

// we track mutations for addedNodes, looking for imports
function handler(mutations) {
  for (var i=0, l=mutations.length, m; (i<l) && (m=mutations[i]); i++) {
    if (m.type === 'childList' && m.addedNodes.length) {
      addedNodes(m.addedNodes);
    }
  }
}

// find loadable elements and add them to the importer
function addedNodes(nodes) {
  for (var i=0, l=nodes.length, n; (i<l) && (n=nodes[i]); i++) {
    if (shouldLoadNode(n)) {
      importer.loadNode(n);
    }
    if (n.children && n.children.length) {
      addedNodes(n.children);
    }
  }
}

function shouldLoadNode(node) {
  return (node.nodeType === 1) && matches.call(node,
      importer.loadSelectorsForNode(node));
}

// x-plat matches
var matches = HTMLElement.prototype.matches ||
    HTMLElement.prototype.matchesSelector ||
    HTMLElement.prototype.webkitMatchesSelector ||
    HTMLElement.prototype.mozMatchesSelector ||
    HTMLElement.prototype.msMatchesSelector;

var observer = new MutationObserver(handler);

// observe the given root for loadable elements
function observe(root) {
  observer.observe(root, {childList: true, subtree: true});
}

// exports
// TODO(sorvell): factor so can put on scope
scope.observe = observe;
importer.observe = observe;

})(HTMLImports);

/*
 * Copyright 2013 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */
(function(){

// bootstrap

// IE shim for CustomEvent
if (typeof window.CustomEvent !== 'function') {
  window.CustomEvent = function(inType, dictionary) {
     var e = document.createEvent('HTMLEvents');
     e.initEvent(inType,
        dictionary.bubbles === false ? false : true,
        dictionary.cancelable === false ? false : true,
        dictionary.detail);
     return e;
  };
}

// TODO(sorvell): SD polyfill intrusion
var doc = window.ShadowDOMPolyfill ?
    window.ShadowDOMPolyfill.wrapIfNeeded(document) : document;

// Fire the 'HTMLImportsLoaded' event when imports in document at load time
// have loaded. This event is required to simulate the script blocking
// behavior of native imports. A main document script that needs to be sure
// imports have loaded should wait for this event.
HTMLImports.whenImportsReady(function() {
  HTMLImports.ready = true;
  HTMLImports.readyTime = new Date().getTime();
  doc.dispatchEvent(
    new CustomEvent('HTMLImportsLoaded', {bubbles: true})
  );
});


// no need to bootstrap the polyfill when native imports is available.
if (!HTMLImports.useNative) {
  function bootstrap() {
    HTMLImports.importer.bootDocument(doc);
  }

  // TODO(sorvell): SD polyfill does *not* generate mutations for nodes added
  // by the parser. For this reason, we must wait until the dom exists to
  // bootstrap.
  if (document.readyState === 'complete' ||
      (document.readyState === 'interactive' && !window.attachEvent)) {
    bootstrap();
  } else {
    document.addEventListener('DOMContentLoaded', bootstrap);
  }
}

})();

// We don't use the platform bootstrapper, so fake this stuff.

window.Platform = {};
var logFlags = {};


// DOMTokenList polyfill for IE9
(function () {

if (typeof window.Element === "undefined" || "classList" in document.documentElement) return;

var prototype = Array.prototype,
    indexOf = prototype.indexOf,
    slice = prototype.slice,
    push = prototype.push,
    splice = prototype.splice,
    join = prototype.join;

function DOMTokenList(el) {
  this._element = el;
  if (el.className != this._classCache) {
    this._classCache = el.className;

    if (!this._classCache) return;

      // The className needs to be trimmed and split on whitespace
      // to retrieve a list of classes.
      var classes = this._classCache.replace(/^\s+|\s+$/g,'').split(/\s+/),
        i;
    for (i = 0; i < classes.length; i++) {
      push.call(this, classes[i]);
    }
  }
};

function setToClassName(el, classes) {
  el.className = classes.join(' ');
}

DOMTokenList.prototype = {
  add: function(token) {
    if(this.contains(token)) return;
    push.call(this, token);
    setToClassName(this._element, slice.call(this, 0));
  },
  contains: function(token) {
    return indexOf.call(this, token) !== -1;
  },
  item: function(index) {
    return this[index] || null;
  },
  remove: function(token) {
    var i = indexOf.call(this, token);
     if (i === -1) {
       return;
     }
    splice.call(this, i, 1);
    setToClassName(this._element, slice.call(this, 0));
  },
  toString: function() {
    return join.call(this, ' ');
  },
  toggle: function(token) {
    if (indexOf.call(this, token) === -1) {
      this.add(token);
    } else {
      this.remove(token);
    }
  }
};

window.DOMTokenList = DOMTokenList;

function defineElementGetter (obj, prop, getter) {
  if (Object.defineProperty) {
    Object.defineProperty(obj, prop,{
      get : getter
    })
  } else {
    obj.__defineGetter__(prop, getter);
  }
}

defineElementGetter(Element.prototype, 'classList', function () {
  return new DOMTokenList(this);
});

})();


/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

if (typeof WeakMap === 'undefined') {
  (function() {
    var defineProperty = Object.defineProperty;
    var counter = Date.now() % 1e9;

    var WeakMap = function() {
      this.name = '__st' + (Math.random() * 1e9 >>> 0) + (counter++ + '__');
    };

    WeakMap.prototype = {
      set: function(key, value) {
        var entry = key[this.name];
        if (entry && entry[0] === key)
          entry[1] = value;
        else
          defineProperty(key, this.name, {value: [key, value], writable: true});
      },
      get: function(key) {
        var entry;
        return (entry = key[this.name]) && entry[0] === key ?
            entry[1] : undefined;
      },
      delete: function(key) {
        this.set(key, undefined);
      }
    };

    window.WeakMap = WeakMap;
  })();
}

/*
 * Copyright 2012 The Polymer Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(global) {

  var registrationsTable = new WeakMap();

  // We use setImmediate or postMessage for our future callback.
  var setImmediate = window.msSetImmediate;

  // Use post message to emulate setImmediate.
  if (!setImmediate) {
    var setImmediateQueue = [];
    var sentinel = String(Math.random());
    window.addEventListener('message', function(e) {
      if (e.data === sentinel) {
        var queue = setImmediateQueue;
        setImmediateQueue = [];
        queue.forEach(function(func) {
          func();
        });
      }
    });
    setImmediate = function(func) {
      setImmediateQueue.push(func);
      window.postMessage(sentinel, '*');
    };
  }

  // This is used to ensure that we never schedule 2 callas to setImmediate
  var isScheduled = false;

  // Keep track of observers that needs to be notified next time.
  var scheduledObservers = [];

  /**
   * Schedules |dispatchCallback| to be called in the future.
   * @param {MutationObserver} observer
   */
  function scheduleCallback(observer) {
    scheduledObservers.push(observer);
    if (!isScheduled) {
      isScheduled = true;
      setImmediate(dispatchCallbacks);
    }
  }

  function wrapIfNeeded(node) {
    return window.ShadowDOMPolyfill &&
        window.ShadowDOMPolyfill.wrapIfNeeded(node) ||
        node;
  }

  function dispatchCallbacks() {
    // http://dom.spec.whatwg.org/#mutation-observers

    isScheduled = false; // Used to allow a new setImmediate call above.

    var observers = scheduledObservers;
    scheduledObservers = [];
    // Sort observers based on their creation UID (incremental).
    observers.sort(function(o1, o2) {
      return o1.uid_ - o2.uid_;
    });

    var anyNonEmpty = false;
    observers.forEach(function(observer) {

      // 2.1, 2.2
      var queue = observer.takeRecords();
      // 2.3. Remove all transient registered observers whose observer is mo.
      removeTransientObserversFor(observer);

      // 2.4
      if (queue.length) {
        observer.callback_(queue, observer);
        anyNonEmpty = true;
      }
    });

    // 3.
    if (anyNonEmpty)
      dispatchCallbacks();
  }

  function removeTransientObserversFor(observer) {
    observer.nodes_.forEach(function(node) {
      var registrations = registrationsTable.get(node);
      if (!registrations)
        return;
      registrations.forEach(function(registration) {
        if (registration.observer === observer)
          registration.removeTransientObservers();
      });
    });
  }

  /**
   * This function is used for the "For each registered observer observer (with
   * observer's options as options) in target's list of registered observers,
   * run these substeps:" and the "For each ancestor ancestor of target, and for
   * each registered observer observer (with options options) in ancestor's list
   * of registered observers, run these substeps:" part of the algorithms. The
   * |options.subtree| is checked to ensure that the callback is called
   * correctly.
   *
   * @param {Node} target
   * @param {function(MutationObserverInit):MutationRecord} callback
   */
  function forEachAncestorAndObserverEnqueueRecord(target, callback) {
    for (var node = target; node; node = node.parentNode) {
      var registrations = registrationsTable.get(node);

      if (registrations) {
        for (var j = 0; j < registrations.length; j++) {
          var registration = registrations[j];
          var options = registration.options;

          // Only target ignores subtree.
          if (node !== target && !options.subtree)
            continue;

          var record = callback(options);
          if (record)
            registration.enqueue(record);
        }
      }
    }
  }

  var uidCounter = 0;

  /**
   * The class that maps to the DOM MutationObserver interface.
   * @param {Function} callback.
   * @constructor
   */
  function JsMutationObserver(callback) {
    this.callback_ = callback;
    this.nodes_ = [];
    this.records_ = [];
    this.uid_ = ++uidCounter;
  }

  JsMutationObserver.prototype = {
    observe: function(target, options) {
      target = wrapIfNeeded(target);

      // 1.1
      if (!options.childList && !options.attributes && !options.characterData ||

          // 1.2
          options.attributeOldValue && !options.attributes ||

          // 1.3
          options.attributeFilter && options.attributeFilter.length &&
              !options.attributes ||

          // 1.4
          options.characterDataOldValue && !options.characterData) {

        throw new SyntaxError();
      }

      var registrations = registrationsTable.get(target);
      if (!registrations)
        registrationsTable.set(target, registrations = []);

      // 2
      // If target's list of registered observers already includes a registered
      // observer associated with the context object, replace that registered
      // observer's options with options.
      var registration;
      for (var i = 0; i < registrations.length; i++) {
        if (registrations[i].observer === this) {
          registration = registrations[i];
          registration.removeListeners();
          registration.options = options;
          break;
        }
      }

      // 3.
      // Otherwise, add a new registered observer to target's list of registered
      // observers with the context object as the observer and options as the
      // options, and add target to context object's list of nodes on which it
      // is registered.
      if (!registration) {
        registration = new Registration(this, target, options);
        registrations.push(registration);
        this.nodes_.push(target);
      }

      registration.addListeners();
    },

    disconnect: function() {
      this.nodes_.forEach(function(node) {
        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          var registration = registrations[i];
          if (registration.observer === this) {
            registration.removeListeners();
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
      this.records_ = [];
    },

    takeRecords: function() {
      var copyOfRecords = this.records_;
      this.records_ = [];
      return copyOfRecords;
    }
  };

  /**
   * @param {string} type
   * @param {Node} target
   * @constructor
   */
  function MutationRecord(type, target) {
    this.type = type;
    this.target = target;
    this.addedNodes = [];
    this.removedNodes = [];
    this.previousSibling = null;
    this.nextSibling = null;
    this.attributeName = null;
    this.attributeNamespace = null;
    this.oldValue = null;
  }

  function copyMutationRecord(original) {
    var record = new MutationRecord(original.type, original.target);
    record.addedNodes = original.addedNodes.slice();
    record.removedNodes = original.removedNodes.slice();
    record.previousSibling = original.previousSibling;
    record.nextSibling = original.nextSibling;
    record.attributeName = original.attributeName;
    record.attributeNamespace = original.attributeNamespace;
    record.oldValue = original.oldValue;
    return record;
  };

  // We keep track of the two (possibly one) records used in a single mutation.
  var currentRecord, recordWithOldValue;

  /**
   * Creates a record without |oldValue| and caches it as |currentRecord| for
   * later use.
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecord(type, target) {
    return currentRecord = new MutationRecord(type, target);
  }

  /**
   * Gets or creates a record with |oldValue| based in the |currentRecord|
   * @param {string} oldValue
   * @return {MutationRecord}
   */
  function getRecordWithOldValue(oldValue) {
    if (recordWithOldValue)
      return recordWithOldValue;
    recordWithOldValue = copyMutationRecord(currentRecord);
    recordWithOldValue.oldValue = oldValue;
    return recordWithOldValue;
  }

  function clearRecords() {
    currentRecord = recordWithOldValue = undefined;
  }

  /**
   * @param {MutationRecord} record
   * @return {boolean} Whether the record represents a record from the current
   * mutation event.
   */
  function recordRepresentsCurrentMutation(record) {
    return record === recordWithOldValue || record === currentRecord;
  }

  /**
   * Selects which record, if any, to replace the last record in the queue.
   * This returns |null| if no record should be replaced.
   *
   * @param {MutationRecord} lastRecord
   * @param {MutationRecord} newRecord
   * @param {MutationRecord}
   */
  function selectRecord(lastRecord, newRecord) {
    if (lastRecord === newRecord)
      return lastRecord;

    // Check if the the record we are adding represents the same record. If
    // so, we keep the one with the oldValue in it.
    if (recordWithOldValue && recordRepresentsCurrentMutation(lastRecord))
      return recordWithOldValue;

    return null;
  }

  /**
   * Class used to represent a registered observer.
   * @param {MutationObserver} observer
   * @param {Node} target
   * @param {MutationObserverInit} options
   * @constructor
   */
  function Registration(observer, target, options) {
    this.observer = observer;
    this.target = target;
    this.options = options;
    this.transientObservedNodes = [];
  }

  Registration.prototype = {
    enqueue: function(record) {
      var records = this.observer.records_;
      var length = records.length;

      // There are cases where we replace the last record with the new record.
      // For example if the record represents the same mutation we need to use
      // the one with the oldValue. If we get same record (this can happen as we
      // walk up the tree) we ignore the new record.
      if (records.length > 0) {
        var lastRecord = records[length - 1];
        var recordToReplaceLast = selectRecord(lastRecord, record);
        if (recordToReplaceLast) {
          records[length - 1] = recordToReplaceLast;
          return;
        }
      } else {
        scheduleCallback(this.observer);
      }

      records[length] = record;
    },

    addListeners: function() {
      this.addListeners_(this.target);
    },

    addListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.addEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.addEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.addEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.addEventListener('DOMNodeRemoved', this, true);
    },

    removeListeners: function() {
      this.removeListeners_(this.target);
    },

    removeListeners_: function(node) {
      var options = this.options;
      if (options.attributes)
        node.removeEventListener('DOMAttrModified', this, true);

      if (options.characterData)
        node.removeEventListener('DOMCharacterDataModified', this, true);

      if (options.childList)
        node.removeEventListener('DOMNodeInserted', this, true);

      if (options.childList || options.subtree)
        node.removeEventListener('DOMNodeRemoved', this, true);
    },

    /**
     * Adds a transient observer on node. The transient observer gets removed
     * next time we deliver the change records.
     * @param {Node} node
     */
    addTransientObserver: function(node) {
      // Don't add transient observers on the target itself. We already have all
      // the required listeners set up on the target.
      if (node === this.target)
        return;

      this.addListeners_(node);
      this.transientObservedNodes.push(node);
      var registrations = registrationsTable.get(node);
      if (!registrations)
        registrationsTable.set(node, registrations = []);

      // We know that registrations does not contain this because we already
      // checked if node === this.target.
      registrations.push(this);
    },

    removeTransientObservers: function() {
      var transientObservedNodes = this.transientObservedNodes;
      this.transientObservedNodes = [];

      transientObservedNodes.forEach(function(node) {
        // Transient observers are never added to the target.
        this.removeListeners_(node);

        var registrations = registrationsTable.get(node);
        for (var i = 0; i < registrations.length; i++) {
          if (registrations[i] === this) {
            registrations.splice(i, 1);
            // Each node can only have one registered observer associated with
            // this observer.
            break;
          }
        }
      }, this);
    },

    handleEvent: function(e) {
      // Stop propagation since we are managing the propagation manually.
      // This means that other mutation events on the page will not work
      // correctly but that is by design.
      e.stopImmediatePropagation();

      switch (e.type) {
        case 'DOMAttrModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-attributes

          var name = e.attrName;
          var namespace = e.relatedNode.namespaceURI;
          var target = e.target;

          // 1.
          var record = new getRecord('attributes', target);
          record.attributeName = name;
          record.attributeNamespace = namespace;

          // 2.
          var oldValue =
              e.attrChange === MutationEvent.ADDITION ? null : e.prevValue;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.attributes)
              return;

            // 3.2, 4.3
            if (options.attributeFilter && options.attributeFilter.length &&
                options.attributeFilter.indexOf(name) === -1 &&
                options.attributeFilter.indexOf(namespace) === -1) {
              return;
            }
            // 3.3, 4.4
            if (options.attributeOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.4, 4.5
            return record;
          });

          break;

        case 'DOMCharacterDataModified':
          // http://dom.spec.whatwg.org/#concept-mo-queue-characterdata
          var target = e.target;

          // 1.
          var record = getRecord('characterData', target);

          // 2.
          var oldValue = e.prevValue;


          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 3.1, 4.2
            if (!options.characterData)
              return;

            // 3.2, 4.3
            if (options.characterDataOldValue)
              return getRecordWithOldValue(oldValue);

            // 3.3, 4.4
            return record;
          });

          break;

        case 'DOMNodeRemoved':
          this.addTransientObserver(e.target);
          // Fall through.
        case 'DOMNodeInserted':
          // http://dom.spec.whatwg.org/#concept-mo-queue-childlist
          var target = e.relatedNode;
          var changedNode = e.target;
          var addedNodes, removedNodes;
          if (e.type === 'DOMNodeInserted') {
            addedNodes = [changedNode];
            removedNodes = [];
          } else {

            addedNodes = [];
            removedNodes = [changedNode];
          }
          var previousSibling = changedNode.previousSibling;
          var nextSibling = changedNode.nextSibling;

          // 1.
          var record = getRecord('childList', target);
          record.addedNodes = addedNodes;
          record.removedNodes = removedNodes;
          record.previousSibling = previousSibling;
          record.nextSibling = nextSibling;

          forEachAncestorAndObserverEnqueueRecord(target, function(options) {
            // 2.1, 3.2
            if (!options.childList)
              return;

            // 2.2, 3.3
            return record;
          });

      }

      clearRecords();
    }
  };

  global.JsMutationObserver = JsMutationObserver;

  if (!global.MutationObserver)
    global.MutationObserver = JsMutationObserver;


})(this);

/*
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

/**
 * Implements `document.registerElement`
 * @module CustomElements
*/

/**
 * Polyfilled extensions to the `document` object.
 * @class Document
*/

(function(scope) {

// imports

if (!scope) {
  scope = window.CustomElements = {flags:{}};
}
var flags = scope.flags;

// native document.registerElement?

var hasNative = Boolean(document.registerElement);
// For consistent timing, use native custom elements only when not polyfilling
// other key related web components features.
var useNative = !flags.register && hasNative && !window.ShadowDOMPolyfill && (!window.HTMLImports || HTMLImports.useNative);

if (useNative) {

  // stub
  var nop = function() {};

  // exports
  scope.registry = {};
  scope.upgradeElement = nop;

  scope.watchShadow = nop;
  scope.upgrade = nop;
  scope.upgradeAll = nop;
  scope.upgradeSubtree = nop;
  scope.observeDocument = nop;
  scope.upgradeDocument = nop;
  scope.upgradeDocumentTree = nop;
  scope.takeRecords = nop;
  scope.reservedTagList = [];

} else {

  /**
   * Registers a custom tag name with the document.
   *
   * When a registered element is created, a `readyCallback` method is called
   * in the scope of the element. The `readyCallback` method can be specified on
   * either `options.prototype` or `options.lifecycle` with the latter taking
   * precedence.
   *
   * @method register
   * @param {String} name The tag name to register. Must include a dash ('-'),
   *    for example 'x-component'.
   * @param {Object} options
   *    @param {String} [options.extends]
   *      (_off spec_) Tag name of an element to extend (or blank for a new
   *      element). This parameter is not part of the specification, but instead
   *      is a hint for the polyfill because the extendee is difficult to infer.
   *      Remember that the input prototype must chain to the extended element's
   *      prototype (or HTMLElement.prototype) regardless of the value of
   *      `extends`.
   *    @param {Object} options.prototype The prototype to use for the new
   *      element. The prototype must inherit from HTMLElement.
   *    @param {Object} [options.lifecycle]
   *      Callbacks that fire at important phases in the life of the custom
   *      element.
   *
   * @example
   *      FancyButton = document.registerElement("fancy-button", {
   *        extends: 'button',
   *        prototype: Object.create(HTMLButtonElement.prototype, {
   *          readyCallback: {
   *            value: function() {
   *              console.log("a fancy-button was created",
   *            }
   *          }
   *        })
   *      });
   * @return {Function} Constructor for the newly registered type.
   */
  function register(name, options) {
    //console.warn('document.registerElement("' + name + '", ', options, ')');
    // construct a defintion out of options
    // TODO(sjmiles): probably should clone options instead of mutating it
    var definition = options || {};
    if (!name) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.registerElement: first argument `name` must not be empty');
    }
    if (name.indexOf('-') < 0) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('document.registerElement: first argument (\'name\') must contain a dash (\'-\'). Argument provided was \'' + String(name) + '\'.');
    }
    // prevent registering reserved names
    if (isReservedTag(name)) {
      throw new Error('Failed to execute \'registerElement\' on \'Document\': Registration failed for type \'' + String(name) + '\'. The type name is invalid.');
    }
    // elements may only be registered once
    if (getRegisteredDefinition(name)) {
      throw new Error('DuplicateDefinitionError: a type with name \'' + String(name) + '\' is already registered');
    }
    // must have a prototype, default to an extension of HTMLElement
    // TODO(sjmiles): probably should throw if no prototype, check spec
    if (!definition.prototype) {
      // TODO(sjmiles): replace with more appropriate error (EricB can probably
      // offer guidance)
      throw new Error('Options missing required prototype property');
    }
    // record name
    definition.__name = name.toLowerCase();
    // ensure a lifecycle object so we don't have to null test it
    definition.lifecycle = definition.lifecycle || {};
    // build a list of ancestral custom elements (for native base detection)
    // TODO(sjmiles): we used to need to store this, but current code only
    // uses it in 'resolveTagName': it should probably be inlined
    definition.ancestry = ancestry(definition.extends);
    // extensions of native specializations of HTMLElement require localName
    // to remain native, and use secondary 'is' specifier for extension type
    resolveTagName(definition);
    // some platforms require modifications to the user-supplied prototype
    // chain
    resolvePrototypeChain(definition);
    // overrides to implement attributeChanged callback
    overrideAttributeApi(definition.prototype);
    // 7.1.5: Register the DEFINITION with DOCUMENT
    registerDefinition(definition.__name, definition);
    // 7.1.7. Run custom element constructor generation algorithm with PROTOTYPE
    // 7.1.8. Return the output of the previous step.
    definition.ctor = generateConstructor(definition);
    definition.ctor.prototype = definition.prototype;
    // force our .constructor to be our actual constructor
    definition.prototype.constructor = definition.ctor;
    // if initial parsing is complete
    if (scope.ready) {
      // upgrade any pre-existing nodes of this type
      scope.upgradeDocumentTree(document);
    }
    return definition.ctor;
  }

  function isReservedTag(name) {
    for (var i = 0; i < reservedTagList.length; i++) {
      if (name === reservedTagList[i]) {
        return true;
      }
    }
  }

  var reservedTagList = [
    'annotation-xml', 'color-profile', 'font-face', 'font-face-src',
    'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'
  ];

  function ancestry(extnds) {
    var extendee = getRegisteredDefinition(extnds);
    if (extendee) {
      return ancestry(extendee.extends).concat([extendee]);
    }
    return [];
  }

  function resolveTagName(definition) {
    // if we are explicitly extending something, that thing is our
    // baseTag, unless it represents a custom component
    var baseTag = definition.extends;
    // if our ancestry includes custom components, we only have a
    // baseTag if one of them does
    for (var i=0, a; (a=definition.ancestry[i]); i++) {
      baseTag = a.is && a.tag;
    }
    // our tag is our baseTag, if it exists, and otherwise just our name
    definition.tag = baseTag || definition.__name;
    if (baseTag) {
      // if there is a base tag, use secondary 'is' specifier
      definition.is = definition.__name;
    }
  }

  function resolvePrototypeChain(definition) {
    // if we don't support __proto__ we need to locate the native level
    // prototype for precise mixing in
    if (!Object.__proto__) {
      // default prototype
      var nativePrototype = HTMLElement.prototype;
      // work out prototype when using type-extension
      if (definition.is) {
        var inst = document.createElement(definition.tag);
        var expectedPrototype = Object.getPrototypeOf(inst);
        // only set nativePrototype if it will actually appear in the definition's chain
        if (expectedPrototype === definition.prototype) {
          nativePrototype = expectedPrototype;
        }
      }
      // ensure __proto__ reference is installed at each point on the prototype
      // chain.
      // NOTE: On platforms without __proto__, a mixin strategy is used instead
      // of prototype swizzling. In this case, this generated __proto__ provides
      // limited support for prototype traversal.
      var proto = definition.prototype, ancestor;
      while (proto && (proto !== nativePrototype)) {
        ancestor = Object.getPrototypeOf(proto);
        proto.__proto__ = ancestor;
        proto = ancestor;
      }
      // cache this in case of mixin
      definition.native = nativePrototype;
    }
  }

  // SECTION 4

  function instantiate(definition) {
    // 4.a.1. Create a new object that implements PROTOTYPE
    // 4.a.2. Let ELEMENT by this new object
    //
    // the custom element instantiation algorithm must also ensure that the
    // output is a valid DOM element with the proper wrapper in place.
    //
    return upgrade(domCreateElement(definition.tag), definition);
  }

  function upgrade(element, definition) {
    // some definitions specify an 'is' attribute
    if (definition.is) {
      element.setAttribute('is', definition.is);
    }
    // make 'element' implement definition.prototype
    implement(element, definition);
    // flag as upgraded
    element.__upgraded__ = true;
    // lifecycle management
    created(element);
    // attachedCallback fires in tree order, call before recursing
    scope.insertedNode(element);
    // there should never be a shadow root on element at this point
    scope.upgradeSubtree(element);
    // OUTPUT
    return element;
  }

  function implement(element, definition) {
    // prototype swizzling is best
    if (Object.__proto__) {
      element.__proto__ = definition.prototype;
    } else {
      // where above we can re-acquire inPrototype via
      // getPrototypeOf(Element), we cannot do so when
      // we use mixin, so we install a magic reference
      customMixin(element, definition.prototype, definition.native);
      element.__proto__ = definition.prototype;
    }
  }

  function customMixin(inTarget, inSrc, inNative) {
    // TODO(sjmiles): 'used' allows us to only copy the 'youngest' version of
    // any property. This set should be precalculated. We also need to
    // consider this for supporting 'super'.
    var used = {};
    // start with inSrc
    var p = inSrc;
    // The default is HTMLElement.prototype, so we add a test to avoid mixing in
    // native prototypes
    while (p !== inNative && p !== HTMLElement.prototype) {
      var keys = Object.getOwnPropertyNames(p);
      for (var i=0, k; k=keys[i]; i++) {
        if (!used[k]) {
          Object.defineProperty(inTarget, k,
              Object.getOwnPropertyDescriptor(p, k));
          used[k] = 1;
        }
      }
      p = Object.getPrototypeOf(p);
    }
  }

  function created(element) {
    // invoke createdCallback
    if (element.createdCallback) {
      element.createdCallback();
    }
  }

  // attribute watching

  function overrideAttributeApi(prototype) {
    // overrides to implement callbacks
    // TODO(sjmiles): should support access via .attributes NamedNodeMap
    // TODO(sjmiles): preserves user defined overrides, if any
    if (prototype.setAttribute._polyfilled) {
      return;
    }
    var setAttribute = prototype.setAttribute;
    prototype.setAttribute = function(name, value) {
      changeAttribute.call(this, name, value, setAttribute);
    }
    var removeAttribute = prototype.removeAttribute;
    prototype.removeAttribute = function(name) {
      changeAttribute.call(this, name, null, removeAttribute);
    }
    prototype.setAttribute._polyfilled = true;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/custom/
  // index.html#dfn-attribute-changed-callback
  function changeAttribute(name, value, operation) {
    name = name.toLowerCase();
    var oldValue = this.getAttribute(name);
    operation.apply(this, arguments);
    var newValue = this.getAttribute(name);
    if (this.attributeChangedCallback
        && (newValue !== oldValue)) {
      this.attributeChangedCallback(name, oldValue, newValue);
    }
  }

  // element registry (maps tag names to definitions)

  var registry = {};

  function getRegisteredDefinition(name) {
    if (name) {
      return registry[name.toLowerCase()];
    }
  }

  function registerDefinition(name, definition) {
    registry[name] = definition;
  }

  function generateConstructor(definition) {
    return function() {
      return instantiate(definition);
    };
  }

  var HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
  function createElementNS(namespace, tag, typeExtension) {
    // NOTE: we do not support non-HTML elements,
    // just call createElementNS for non HTML Elements
    if (namespace === HTML_NAMESPACE) {
      return createElement(tag, typeExtension);
    } else {
      return domCreateElementNS(namespace, tag);
    }
  }

  function createElement(tag, typeExtension) {
    // TODO(sjmiles): ignore 'tag' when using 'typeExtension', we could
    // error check it, or perhaps there should only ever be one argument
    var definition = getRegisteredDefinition(typeExtension || tag);
    if (definition) {
      if (tag == definition.tag && typeExtension == definition.is) {
        return new definition.ctor();
      }
      // Handle empty string for type extension.
      if (!typeExtension && !definition.is) {
        return new definition.ctor();
      }
    }

    if (typeExtension) {
      var element = createElement(tag);
      element.setAttribute('is', typeExtension);
      return element;
    }
    var element = domCreateElement(tag);
    // Custom tags should be HTMLElements even if not upgraded.
    if (tag.indexOf('-') >= 0) {
      implement(element, HTMLElement);
    }
    return element;
  }

  function upgradeElement(element) {
    if (!element.__upgraded__ && (element.nodeType === Node.ELEMENT_NODE)) {
      var is = element.getAttribute('is');
      var definition = getRegisteredDefinition(is || element.localName);
      if (definition) {
        if (is && definition.tag == element.localName) {
          return upgrade(element, definition);
        } else if (!is && !definition.extends) {
          return upgrade(element, definition);
        }
      }
    }
  }

  function cloneNode(deep) {
    // call original clone
    var n = domCloneNode.call(this, deep);
    // upgrade the element and subtree
    scope.upgradeAll(n);
    // return the clone
    return n;
  }
  // capture native createElement before we override it

  var domCreateElement = document.createElement.bind(document);
  var domCreateElementNS = document.createElementNS.bind(document);

  // capture native cloneNode before we override it

  var domCloneNode = Node.prototype.cloneNode;

  // exports

  document.registerElement = register;
  document.createElement = createElement; // override
  document.createElementNS = createElementNS; // override
  Node.prototype.cloneNode = cloneNode; // override

  scope.registry = registry;

  /**
   * Upgrade an element to a custom element. Upgrading an element
   * causes the custom prototype to be applied, an `is` attribute
   * to be attached (as needed), and invocation of the `readyCallback`.
   * `upgrade` does nothing if the element is already upgraded, or
   * if it matches no registered custom tag name.
   *
   * @method ugprade
   * @param {Element} element The element to upgrade.
   * @return {Element} The upgraded element.
   */
  scope.upgrade = upgradeElement;
}

// Create a custom 'instanceof'. This is necessary when CustomElements
// are implemented via a mixin strategy, as for example on IE10.
var isInstance;
if (!Object.__proto__ && !useNative) {
  isInstance = function(obj, ctor) {
    var p = obj;
    while (p) {
      // NOTE: this is not technically correct since we're not checking if
      // an object is an instance of a constructor; however, this should
      // be good enough for the mixin strategy.
      if (p === ctor.prototype) {
        return true;
      }
      p = p.__proto__;
    }
    return false;
  }
} else {
  isInstance = function(obj, base) {
    return obj instanceof base;
  }
}

// exports
scope.instanceof = isInstance;
scope.reservedTagList = reservedTagList;

// bc
document.register = document.registerElement;

scope.hasNative = hasNative;
scope.useNative = useNative;

})(window.CustomElements);

/*
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

(function(scope){

var logFlags = window.logFlags || {};
var IMPORT_LINK_TYPE = window.HTMLImports ? HTMLImports.IMPORT_LINK_TYPE : 'none';

// walk the subtree rooted at node, applying 'find(element, data)' function
// to each element
// if 'find' returns true for 'element', do not search element's subtree
function findAll(node, find, data) {
  var e = node.firstElementChild;
  if (!e) {
    e = node.firstChild;
    while (e && e.nodeType !== Node.ELEMENT_NODE) {
      e = e.nextSibling;
    }
  }
  while (e) {
    if (find(e, data) !== true) {
      findAll(e, find, data);
    }
    e = e.nextElementSibling;
  }
  return null;
}

// walk all shadowRoots on a given node.
function forRoots(node, cb) {
  var root = node.shadowRoot;
  while(root) {
    forSubtree(root, cb);
    root = root.olderShadowRoot;
  }
}

// walk the subtree rooted at node, including descent into shadow-roots,
// applying 'cb' to each element
function forSubtree(node, cb) {
  //logFlags.dom && node.childNodes && node.childNodes.length && console.group('subTree: ', node);
  findAll(node, function(e) {
    if (cb(e)) {
      return true;
    }
    forRoots(e, cb);
  });
  forRoots(node, cb);
  //logFlags.dom && node.childNodes && node.childNodes.length && console.groupEnd();
}

// manage lifecycle on added node
function added(node) {
  if (upgrade(node)) {
    insertedNode(node);
    return true;
  }
  inserted(node);
}

// manage lifecycle on added node's subtree only
function addedSubtree(node) {
  forSubtree(node, function(e) {
    if (added(e)) {
      return true;
    }
  });
}

// manage lifecycle on added node and it's subtree
function addedNode(node) {
  return added(node) || addedSubtree(node);
}

// upgrade custom elements at node, if applicable
function upgrade(node) {
  if (!node.__upgraded__ && node.nodeType === Node.ELEMENT_NODE) {
    var type = node.getAttribute('is') || node.localName;
    var definition = scope.registry[type];
    if (definition) {
      logFlags.dom && console.group('upgrade:', node.localName);
      scope.upgrade(node);
      logFlags.dom && console.groupEnd();
      return true;
    }
  }
}

function insertedNode(node) {
  inserted(node);
  if (inDocument(node)) {
    forSubtree(node, function(e) {
      inserted(e);
    });
  }
}

// TODO(sorvell): on platforms without MutationObserver, mutations may not be
// reliable and therefore attached/detached are not reliable.
// To make these callbacks less likely to fail, we defer all inserts and removes
// to give a chance for elements to be inserted into dom.
// This ensures attachedCallback fires for elements that are created and
// immediately added to dom.
var hasPolyfillMutations = (!window.MutationObserver ||
    (window.MutationObserver === window.JsMutationObserver));
scope.hasPolyfillMutations = hasPolyfillMutations;

var isPendingMutations = false;
var pendingMutations = [];
function deferMutation(fn) {
  pendingMutations.push(fn);
  if (!isPendingMutations) {
    isPendingMutations = true;
    var async = (window.Platform && window.Platform.endOfMicrotask) ||
        setTimeout;
    async(takeMutations);
  }
}

function takeMutations() {
  isPendingMutations = false;
  var $p = pendingMutations;
  for (var i=0, l=$p.length, p; (i<l) && (p=$p[i]); i++) {
    p();
  }
  pendingMutations = [];
}

function inserted(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _inserted(element);
    });
  } else {
    _inserted(element);
  }
}

// TODO(sjmiles): if there are descents into trees that can never have inDocument(*) true, fix this
function _inserted(element) {
  // TODO(sjmiles): it's possible we were inserted and removed in the space
  // of one microtask, in which case we won't be 'inDocument' here
  // But there are other cases where we are testing for inserted without
  // specific knowledge of mutations, and must test 'inDocument' to determine
  // whether to call inserted
  // If we can factor these cases into separate code paths we can have
  // better diagnostics.
  // TODO(sjmiles): when logging, do work on all custom elements so we can
  // track behavior even when callbacks not defined
  //console.log('inserted: ', element.localName);
  if (element.attachedCallback || element.detachedCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.group('inserted:', element.localName);
    if (inDocument(element)) {
      element.__inserted = (element.__inserted || 0) + 1;
      // if we are in a 'removed' state, bluntly adjust to an 'inserted' state
      if (element.__inserted < 1) {
        element.__inserted = 1;
      }
      // if we are 'over inserted', squelch the callback
      if (element.__inserted > 1) {
        logFlags.dom && console.warn('inserted:', element.localName,
          'insert/remove count:', element.__inserted)
      } else if (element.attachedCallback) {
        logFlags.dom && console.log('inserted:', element.localName);
        element.attachedCallback();
      }
    }
    logFlags.dom && console.groupEnd();
  }
}

function removedNode(node) {
  removed(node);
  forSubtree(node, function(e) {
    removed(e);
  });
}

function removed(element) {
  if (hasPolyfillMutations) {
    deferMutation(function() {
      _removed(element);
    });
  } else {
    _removed(element);
  }
}

function _removed(element) {
  // TODO(sjmiles): temporary: do work on all custom elements so we can track
  // behavior even when callbacks not defined
  if (element.attachedCallback || element.detachedCallback || (element.__upgraded__ && logFlags.dom)) {
    logFlags.dom && console.group('removed:', element.localName);
    if (!inDocument(element)) {
      element.__inserted = (element.__inserted || 0) - 1;
      // if we are in a 'inserted' state, bluntly adjust to an 'removed' state
      if (element.__inserted > 0) {
        element.__inserted = 0;
      }
      // if we are 'over removed', squelch the callback
      if (element.__inserted < 0) {
        logFlags.dom && console.warn('removed:', element.localName,
            'insert/remove count:', element.__inserted)
      } else if (element.detachedCallback) {
        element.detachedCallback();
      }
    }
    logFlags.dom && console.groupEnd();
  }
}

// SD polyfill intrustion due mainly to the fact that 'document'
// is not entirely wrapped
function wrapIfNeeded(node) {
  return window.ShadowDOMPolyfill ? ShadowDOMPolyfill.wrapIfNeeded(node)
      : node;
}

function inDocument(element) {
  var p = element;
  var doc = wrapIfNeeded(document);
  while (p) {
    if (p == doc) {
      return true;
    }
    p = p.parentNode || p.host;
  }
}

function watchShadow(node) {
  if (node.shadowRoot && !node.shadowRoot.__watched) {
    logFlags.dom && console.log('watching shadow-root for: ', node.localName);
    // watch all unwatched roots...
    var root = node.shadowRoot;
    while (root) {
      watchRoot(root);
      root = root.olderShadowRoot;
    }
  }
}

function watchRoot(root) {
  if (!root.__watched) {
    observe(root);
    root.__watched = true;
  }
}

function handler(mutations) {
  //
  if (logFlags.dom) {
    var mx = mutations[0];
    if (mx && mx.type === 'childList' && mx.addedNodes) {
        if (mx.addedNodes) {
          var d = mx.addedNodes[0];
          while (d && d !== document && !d.host) {
            d = d.parentNode;
          }
          var u = d && (d.URL || d._URL || (d.host && d.host.localName)) || '';
          u = u.split('/?').shift().split('/').pop();
        }
    }
    console.group('mutations (%d) [%s]', mutations.length, u || '');
  }
  //
  mutations.forEach(function(mx) {
    //logFlags.dom && console.group('mutation');
    if (mx.type === 'childList') {
      forEach(mx.addedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (!n.localName) {
          return;
        }
        // nodes added may need lifecycle management
        addedNode(n);
      });
      // removed nodes may need lifecycle management
      forEach(mx.removedNodes, function(n) {
        //logFlags.dom && console.log(n.localName);
        if (!n.localName) {
          return;
        }
        removedNode(n);
      });
    }
    //logFlags.dom && console.groupEnd();
  });
  logFlags.dom && console.groupEnd();
};

var observer = new MutationObserver(handler);

function takeRecords() {
  // TODO(sjmiles): ask Raf why we have to call handler ourselves
  handler(observer.takeRecords());
  takeMutations();
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

function observe(inRoot) {
  observer.observe(inRoot, {childList: true, subtree: true});
}

function observeDocument(doc) {
  observe(doc);
}

function upgradeDocument(doc) {
  logFlags.dom && console.group('upgradeDocument: ', (doc.baseURI).split('/').pop());
  addedNode(doc);
  logFlags.dom && console.groupEnd();
}

function upgradeDocumentTree(doc) {
  doc = wrapIfNeeded(doc);
  //console.log('upgradeDocumentTree: ', (doc.baseURI).split('/').pop());
  // upgrade contained imported documents
  var imports = doc.querySelectorAll('link[rel=' + IMPORT_LINK_TYPE + ']');
  for (var i=0, l=imports.length, n; (i<l) && (n=imports[i]); i++) {
    if (n.import && n.import.__parsed) {
      upgradeDocumentTree(n.import);
    }
  }
  upgradeDocument(doc);
}

// exports
scope.IMPORT_LINK_TYPE = IMPORT_LINK_TYPE;
scope.watchShadow = watchShadow;
scope.upgradeDocumentTree = upgradeDocumentTree;
scope.upgradeAll = addedNode;
scope.upgradeSubtree = addedSubtree;
scope.insertedNode = insertedNode;

scope.observeDocument = observeDocument;
scope.upgradeDocument = upgradeDocument;

scope.takeRecords = takeRecords;

})(window.CustomElements);

/*
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

(function(scope) {

// import

var IMPORT_LINK_TYPE = scope.IMPORT_LINK_TYPE;

// highlander object for parsing a document tree

var parser = {
  selectors: [
    'link[rel=' + IMPORT_LINK_TYPE + ']'
  ],
  map: {
    link: 'parseLink'
  },
  parse: function(inDocument) {
    if (!inDocument.__parsed) {
      // only parse once
      inDocument.__parsed = true;
      // all parsable elements in inDocument (depth-first pre-order traversal)
      var elts = inDocument.querySelectorAll(parser.selectors);
      // for each parsable node type, call the mapped parsing method
      forEach(elts, function(e) {
        parser[parser.map[e.localName]](e);
      });
      // upgrade all upgradeable static elements, anything dynamically
      // created should be caught by observer
      CustomElements.upgradeDocument(inDocument);
      // observe document for dom changes
      CustomElements.observeDocument(inDocument);
    }
  },
  parseLink: function(linkElt) {
    // imports
    if (isDocumentLink(linkElt)) {
      this.parseImport(linkElt);
    }
  },
  parseImport: function(linkElt) {
    if (linkElt.import) {
      parser.parse(linkElt.import);
    }
  }
};

function isDocumentLink(inElt) {
  return (inElt.localName === 'link'
      && inElt.getAttribute('rel') === IMPORT_LINK_TYPE);
}

var forEach = Array.prototype.forEach.call.bind(Array.prototype.forEach);

// exports

scope.parser = parser;
scope.IMPORT_LINK_TYPE = IMPORT_LINK_TYPE;

})(window.CustomElements);
/*
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
(function(scope){

// bootstrap parsing
function bootstrap() {
  // parse document
  CustomElements.parser.parse(document);
  // one more pass before register is 'live'
  CustomElements.upgradeDocument(document);
  // install upgrade hook if HTMLImports are available
  if (window.HTMLImports) {
    HTMLImports.__importsParsingHook = function(elt) {
      CustomElements.parser.parse(elt.import);
    }
  }
  // set internal 'ready' flag, now document.registerElement will trigger
  // synchronous upgrades
  CustomElements.ready = true;
  // async to ensure *native* custom elements upgrade prior to this
  // DOMContentLoaded can fire before elements upgrade (e.g. when there's
  // an external script)
  setTimeout(function() {
    // capture blunt profiling data
    CustomElements.readyTime = Date.now();
    if (window.HTMLImports) {
      CustomElements.elapsed = CustomElements.readyTime - HTMLImports.readyTime;
    }
    // notify the system that we are bootstrapped
    document.dispatchEvent(
      new CustomEvent('WebComponentsReady', {bubbles: true})
    );
  });
}

// CustomEvent shim for IE
if (typeof window.CustomEvent !== 'function') {
  window.CustomEvent = function(inType, params) {
    params = params || {};
    var e = document.createEvent('CustomEvent');
    e.initCustomEvent(inType, Boolean(params.bubbles), Boolean(params.cancelable), params.detail);
    return e;
  };
  window.CustomEvent.prototype = window.Event.prototype;
}

// When loading at readyState complete time (or via flag), boot custom elements
// immediately.
// If relevant, HTMLImports must already be loaded.
if (document.readyState === 'complete' || scope.flags.eager) {
  bootstrap();
// When loading at readyState interactive time, bootstrap only if HTMLImports
// are not pending. Also avoid IE as the semantics of this state are unreliable.
} else if (document.readyState === 'interactive' && !window.attachEvent &&
    (!window.HTMLImports || window.HTMLImports.ready)) {
  bootstrap();
// When loading at other readyStates, wait for the appropriate DOM event to
// bootstrap.
} else {
  var loadEvent = window.HTMLImports && !HTMLImports.ready ?
      'HTMLImportsLoaded' : 'DOMContentLoaded';
  window.addEventListener(loadEvent, bootstrap);
}

})(window.CustomElements);

(function () {

/*** Variables ***/

  var win = window,
    doc = document,
    container = doc.createElement('div'),
    noop = function(){},
    trueop = function(){ return true; },
    regexPseudoSplit = /([\w-]+(?:\([^\)]+\))?)/g,
    regexPseudoReplace = /(\w*)(?:\(([^\)]*)\))?/,
    regexDigits = /(\d+)/g,
    keypseudo = {
      action: function (pseudo, event) {
        return pseudo.value.match(regexDigits).indexOf(String(event.keyCode)) > -1 == (pseudo.name == 'keypass') || null;
      }
    },
    /*
      - The prefix object generated here is added to the xtag object as xtag.prefix later in the code
      - Prefix provides a variety of prefix variations for the browser in which your code is running
      - The 4 variations of prefix are as follows:
        * prefix.dom: the correct prefix case and form when used on DOM elements/style properties
        * prefix.lowercase: a lowercase version of the prefix for use in various user-code situations
        * prefix.css: the lowercase, dashed version of the prefix
        * prefix.js: addresses prefixed APIs present in global and non-Element contexts
    */
    prefix = (function () {
      var styles = win.getComputedStyle(doc.documentElement, ''),
          pre = (Array.prototype.slice
            .call(styles)
            .join('')
            .match(/-(moz|webkit|ms)-/) || (styles.OLink === '' && ['', 'o'])
          )[1];
      return {
        dom: pre == 'ms' ? 'MS' : pre,
        lowercase: pre,
        css: '-' + pre + '-',
        js: pre == 'ms' ? pre : pre[0].toUpperCase() + pre.substr(1)
      };
    })(),
    matchSelector = Element.prototype.matchesSelector || Element.prototype[prefix.lowercase + 'MatchesSelector'],
    mutation = win.MutationObserver || win[prefix.js + 'MutationObserver'];

/*** Functions ***/

// Utilities

  /*
    This is an enhanced typeof check for all types of objects. Where typeof would normaly return
    'object' for many common DOM objects (like NodeLists and HTMLCollections).
    - For example: typeOf(document.children) will correctly return 'htmlcollection'
  */
  var typeCache = {},
      typeString = typeCache.toString,
      typeRegexp = /\s([a-zA-Z]+)/;
  function typeOf(obj) {
    var type = typeString.call(obj);
    return typeCache[type] || (typeCache[type] = type.match(typeRegexp)[1].toLowerCase());
  }

  function clone(item, type){
    var fn = clone[type || typeOf(item)];
    return fn ? fn(item) : item;
  }
    clone.object = function(src){
      var obj = {};
      for (var key in src) obj[key] = clone(src[key]);
      return obj;
    };
    clone.array = function(src){
      var i = src.length, array = new Array(i);
      while (i--) array[i] = clone(src[i]);
      return array;
    };

  /*
    The toArray() method allows for conversion of any object to a true array. For types that
    cannot be converted to an array, the method returns a 1 item array containing the passed-in object.
  */
  var unsliceable = ['undefined', 'null', 'number', 'boolean', 'string', 'function'];
  function toArray(obj){
    return unsliceable.indexOf(typeOf(obj)) == -1 ?
    Array.prototype.slice.call(obj, 0) :
    [obj];
  }

// DOM

  var str = '';
  function query(element, selector){
    return (selector || str).length ? toArray(element.querySelectorAll(selector)) : [];
  }

  function parseMutations(element, mutations) {
    var diff = { added: [], removed: [] };
    mutations.forEach(function(record){
      record._mutation = true;
      for (var z in diff) {
        var type = element._records[(z == 'added') ? 'inserted' : 'removed'],
          nodes = record[z + 'Nodes'], length = nodes.length;
        for (var i = 0; i < length && diff[z].indexOf(nodes[i]) == -1; i++){
          diff[z].push(nodes[i]);
          type.forEach(function(fn){
            fn(nodes[i], record);
          });
        }
      }
    });
  }

// Mixins

  function mergeOne(source, key, current){
    var type = typeOf(current);
    if (type == 'object' && typeOf(source[key]) == 'object') xtag.merge(source[key], current);
    else source[key] = clone(current, type);
    return source;
  }

  function wrapMixin(tag, key, pseudo, value, original){
    var fn = original[key];
    if (!(key in original)) {
      original[key + (pseudo.match(':mixins') ? '' : ':mixins')] = value;
    }
    else if (typeof original[key] == 'function') {
      if (!fn.__mixins__) fn.__mixins__ = [];
      fn.__mixins__.push(xtag.applyPseudos(pseudo, value, tag.pseudos));
    }
  }

  var uniqueMixinCount = 0;
  function mergeMixin(tag, mixin, original, mix) {
    if (mix) {
      var uniques = {};
      for (var z in original) uniques[z.split(':')[0]] = z;
      for (z in mixin) {
        wrapMixin(tag, uniques[z.split(':')[0]] || z, z, mixin[z], original);
      }
    }
    else {
      for (var zz in mixin){
        original[zz + ':__mixin__(' + (uniqueMixinCount++) + ')'] = xtag.applyPseudos(zz, mixin[zz], tag.pseudos);
      }
    }
  }

  function applyMixins(tag) {
    tag.mixins.forEach(function (name) {
      var mixin = xtag.mixins[name];
      for (var type in mixin) {
        var item = mixin[type],
            original = tag[type];
        if (!original) tag[type] = item;
        else {
          switch (type){
            case 'accessors': case 'prototype':
              for (var z in item) {
                if (!original[z]) original[z] = item[z];
                else mergeMixin(tag, item[z], original[z], true);
              }
              break;
            default: mergeMixin(tag, item, original, type != 'events');
          }
        }
      }
    });
    return tag;
  }

// Events

  function delegateAction(pseudo, event) {
    var match, target = event.target;
    if (!target.tagName) return null;
    if (xtag.matchSelector(target, pseudo.value)) match = target;
    else if (xtag.matchSelector(target, pseudo.value + ' *')) {
      var parent = target.parentNode;
      while (!match) {
        if (xtag.matchSelector(parent, pseudo.value)) match = parent;
        parent = parent.parentNode;
      }
    }
    return match ? pseudo.listener = pseudo.listener.bind(match) : null;
  }

  function touchFilter(event) {
    if (event.type.match('touch')){
      event.target.__touched__ = true;
    }
    else if (event.target.__touched__ && event.type.match('mouse')){
      delete event.target.__touched__;
      return;
    }
    return true;
  }

  function createFlowEvent(type) {
    var flow = type == 'over';
    return {
      attach: 'OverflowEvent' in win ? 'overflowchanged' : [],
      condition: function (event, custom) {
        event.flow = type;
        return event.type == (type + 'flow') ||
        ((event.orient === 0 && event.horizontalOverflow == flow) ||
        (event.orient == 1 && event.verticalOverflow == flow) ||
        (event.orient == 2 && event.horizontalOverflow == flow && event.verticalOverflow == flow));
      }
    };
  }

  function writeProperty(key, event, base, desc){
    if (desc) event[key] = base[key];
    else Object.defineProperty(event, key, {
      writable: true,
      enumerable: true,
      value: base[key]
    });
  }

  var skipProps = {};
  for (var z in doc.createEvent('CustomEvent')) skipProps[z] = 1;
  function inheritEvent(event, base){
    var desc = Object.getOwnPropertyDescriptor(event, 'target');
    for (var z in base) {
      if (!skipProps[z]) writeProperty(z, event, base, desc);
    }
    event.baseEvent = base;
  }

// Accessors

  function getArgs(attr, value){
    return {
      value: attr.boolean ? '' : value,
      method: attr.boolean && !value ? 'removeAttribute' : 'setAttribute'
    };
  }

  function modAttr(element, attr, name, value){
    var args = getArgs(attr, value);
    element[args.method](name, args.value);
  }

  function syncAttr(element, attr, name, value, method){
    var nodes = attr.property ? [element.xtag[attr.property]] : attr.selector ? xtag.query(element, attr.selector) : [],
        index = nodes.length;
    while (index--) nodes[index][method](name, value);
  }

  function updateView(element, name, value){
    if (element.__view__){
      element.__view__.updateBindingValue(element, name, value);
    }
  }

  function attachProperties(tag, prop, z, accessor, attr, name){
    var key = z.split(':'), type = key[0];
    if (type == 'get') {
      key[0] = prop;
      tag.prototype[prop].get = xtag.applyPseudos(key.join(':'), accessor[z], tag.pseudos, accessor[z]);
    }
    else if (type == 'set') {
      key[0] = prop;
      var setter = tag.prototype[prop].set = xtag.applyPseudos(key.join(':'), attr ? function(value){
        this.xtag._skipSet = true;
        if (!this.xtag._skipAttr) modAttr(this, attr, name, value);
        if (this.xtag._skipAttr && attr.skip) delete this.xtag._skipAttr;
        accessor[z].call(this, attr.boolean ? !!value : value);
        updateView(this, name, value);
        delete this.xtag._skipSet;
      } : accessor[z] ? function(value){
        accessor[z].call(this, value);
        updateView(this, name, value);
      } : null, tag.pseudos, accessor[z]);

      if (attr) attr.setter = setter;
    }
    else tag.prototype[prop][z] = accessor[z];
  }

  function parseAccessor(tag, prop){
    tag.prototype[prop] = {};
    var accessor = tag.accessors[prop],
        attr = accessor.attribute,
        name = attr && attr.name ? attr.name.toLowerCase() : prop;

    if (attr) {
      attr.key = prop;
      tag.attributes[name] = attr;
    }

    for (var z in accessor) attachProperties(tag, prop, z, accessor, attr, name);

    if (attr) {
      if (!tag.prototype[prop].get) {
        var method = (attr.boolean ? 'has' : 'get') + 'Attribute';
        tag.prototype[prop].get = function(){
          return this[method](name);
        };
      }
      if (!tag.prototype[prop].set) tag.prototype[prop].set = function(value){
        modAttr(this, attr, name, value);
        updateView(this, name, value);
      };
    }
  }

  var unwrapComment = /\/\*!?(?:\@preserve)?[ \t]*(?:\r\n|\n)([\s\S]*?)(?:\r\n|\n)\s*\*\//;
  function parseMultiline(fn){
    return unwrapComment.exec(fn.toString())[1];
  }

  var readyTags = {};
  function fireReady(name){
    readyTags[name] = (readyTags[name] || []).filter(function(obj){
      return (obj.tags = obj.tags.filter(function(z){
        return z != name && !xtag.tags[z];
      })).length || obj.fn();
    });
  }

/*** X-Tag Object Definition ***/

  var xtag = {
    tags: {},
    defaultOptions: {
      pseudos: [],
      mixins: [],
      events: {},
      methods: {},
      accessors: {},
      lifecycle: {},
      attributes: {},
      'prototype': {
        xtag: {
          get: function(){
            return this.__xtag__ ? this.__xtag__ : (this.__xtag__ = { data: {} });
          }
        }
      }
    },
    register: function (name, options) {
      var _name;
      if (typeof name == 'string') {
        _name = name.toLowerCase();
      } else {
        return;
      }
      xtag.tags[_name] = options || {};
      // save prototype for actual object creation below
      var basePrototype = options.prototype;
      delete options.prototype;
      var tag = xtag.tags[_name].compiled = applyMixins(xtag.merge({}, xtag.defaultOptions, options));

      for (var z in tag.events) tag.events[z] = xtag.parseEvent(z, tag.events[z]);
      for (z in tag.lifecycle) tag.lifecycle[z.split(':')[0]] = xtag.applyPseudos(z, tag.lifecycle[z], tag.pseudos, tag.lifecycle[z]);
      for (z in tag.methods) tag.prototype[z.split(':')[0]] = { value: xtag.applyPseudos(z, tag.methods[z], tag.pseudos, tag.methods[z]), enumerable: true };
      for (z in tag.accessors) parseAccessor(tag, z);

      var shadow = tag.shadow ? xtag.createFragment(tag.shadow) : null;

      var ready = tag.lifecycle.created || tag.lifecycle.ready;
      tag.prototype.createdCallback = {
        enumerable: true,
        value: function(){
          var element = this;
          if (shadow && this.createShadowRoot) {
            var root = this.createShadowRoot();
            root.appendChild(shadow.cloneNode(true));
          }
          xtag.addEvents(this, tag.events);
          var output = ready ? ready.apply(this, arguments) : null;
          for (var name in tag.attributes) {
            var attr = tag.attributes[name],
                hasAttr = this.hasAttribute(name);
            if (hasAttr || attr.boolean) {
              this[attr.key] = attr.boolean ? hasAttr : this.getAttribute(name);
            }
          }
          tag.pseudos.forEach(function(obj){
            obj.onAdd.call(element, obj);
          });
          return output;
        }
      };

      var inserted = tag.lifecycle.inserted,
          removed = tag.lifecycle.removed;
      if (inserted || removed) {
        tag.prototype.attachedCallback = { value: function(){
          if (removed) this.xtag.__parentNode__ = this.parentNode;
          if (inserted) return inserted.apply(this, arguments);
        }, enumerable: true };
      }
      if (removed) {
        tag.prototype.detachedCallback = { value: function(){
          var args = toArray(arguments);
          args.unshift(this.xtag.__parentNode__);
          var output = removed.apply(this, args);
          delete this.xtag.__parentNode__;
          return output;
        }, enumerable: true };
      }
      if (tag.lifecycle.attributeChanged) tag.prototype.attributeChangedCallback = { value: tag.lifecycle.attributeChanged, enumerable: true };

      var setAttribute = tag.prototype.setAttribute || HTMLElement.prototype.setAttribute;
      tag.prototype.setAttribute = {
        writable: true,
        enumberable: true,
        value: function (name, value){
          var attr = tag.attributes[name.toLowerCase()];
          if (!this.xtag._skipAttr) setAttribute.call(this, name, attr && attr.boolean ? '' : value);
          if (attr) {
            if (attr.setter && !this.xtag._skipSet) {
              this.xtag._skipAttr = true;
              attr.setter.call(this, attr.boolean ? true : value);
            }
            value = attr.skip ? attr.boolean ? this.hasAttribute(name) : this.getAttribute(name) : value;
            syncAttr(this, attr, name, attr.boolean ? '' : value, 'setAttribute');
          }
          delete this.xtag._skipAttr;
        }
      };

      var removeAttribute = tag.prototype.removeAttribute || HTMLElement.prototype.removeAttribute;
      tag.prototype.removeAttribute = {
        writable: true,
        enumberable: true,
        value: function (name){
          var attr = tag.attributes[name.toLowerCase()];
          if (!this.xtag._skipAttr) removeAttribute.call(this, name);
          if (attr) {
            if (attr.setter && !this.xtag._skipSet) {
              this.xtag._skipAttr = true;
              attr.setter.call(this, attr.boolean ? false : undefined);
            }
            syncAttr(this, attr, name, undefined, 'removeAttribute');
          }
          delete this.xtag._skipAttr;
        }
      };

      var elementProto = basePrototype ?
            basePrototype :
            options['extends'] ?
            Object.create(doc.createElement(options['extends']).constructor).prototype :
            win.HTMLElement.prototype;

      var definition = {
        'prototype': Object.create(elementProto, tag.prototype)
      };
      if (options['extends']) {
        definition['extends'] = options['extends'];
      }
      var reg = doc.registerElement(_name, definition);
      fireReady(_name);
      return reg;
    },

    /*
      NEEDS MORE TESTING!

      Allows for async dependency resolution, fires when all passed-in elements are
      registered and parsed
    */
    ready: function(names, fn){
      var obj = { tags: toArray(names), fn: fn };
      if (obj.tags.reduce(function(last, name){
        if (xtag.tags[name]) return last;
        (readyTags[name] = readyTags[name] || []).push(obj);
      }, true)) fn();
    },

    /* Exposed Variables */

    mixins: {},
    prefix: prefix,
    captureEvents: ['focus', 'blur', 'scroll', 'underflow', 'overflow', 'overflowchanged', 'DOMMouseScroll'],
    customEvents: {
      overflow: createFlowEvent('over'),
      underflow: createFlowEvent('under'),
      animationstart: {
        attach: [prefix.dom + 'AnimationStart']
      },
      animationend: {
        attach: [prefix.dom + 'AnimationEnd']
      },
      transitionend: {
        attach: [prefix.dom + 'TransitionEnd']
      },
      move: {
        attach: ['mousemove', 'touchmove'],
        condition: touchFilter
      },
      enter: {
        attach: ['mouseover', 'touchenter'],
        condition: touchFilter
      },
      leave: {
        attach: ['mouseout', 'touchleave'],
        condition: touchFilter
      },
      scrollwheel: {
        attach: ['DOMMouseScroll', 'mousewheel'],
        condition: function(event){
          event.delta = event.wheelDelta ? event.wheelDelta / 40 : Math.round(event.detail / 3.5 * -1);
          return true;
        }
      },
      tapstart: {
        observe: {
          mousedown: doc,
          touchstart: doc
        },
        condition: touchFilter
      },
      tapend: {
        observe: {
          mouseup: doc,
          touchend: doc
        },
        condition: touchFilter
      },
      tapmove: {
        attach: ['tapstart', 'dragend', 'touchcancel'],
        condition: function(event, custom){
          switch (event.type) {
            case 'move':  return true;
            case 'dragover':
              var last = custom.lastDrag || {};
              custom.lastDrag = event;
              return (last.pageX != event.pageX && last.pageY != event.pageY) || null;
            case 'tapstart':
              if (!custom.move) {
                custom.current = this;
                custom.move = xtag.addEvents(this, {
                  move: custom.listener,
                  dragover: custom.listener
                });
                custom.tapend = xtag.addEvent(doc, 'tapend', custom.listener);
              }
              break;
            case 'tapend': case 'dragend': case 'touchcancel':
              if (!event.touches.length) {
                if (custom.move) xtag.removeEvents(custom.current , custom.move || {});
                if (custom.tapend) xtag.removeEvent(doc, custom.tapend || {});
                delete custom.lastDrag;
                delete custom.current;
                delete custom.tapend;
                delete custom.move;
              }
          }
        }
      }
    },
    pseudos: {
      __mixin__: {},
      /*


      */
      mixins: {
        onCompiled: function(fn, pseudo){
          var mixins = pseudo.source.__mixins__;
          if (mixins) switch (pseudo.value) {
            case 'before': return function(){
              var self = this,
                  args = arguments;
              mixins.forEach(function(m){
                m.apply(self, args);
              });
              return fn.apply(self, args);
            };
            case null: case '': case 'after': return function(){
              var self = this,
                  args = arguments;
                  returns = fn.apply(self, args);
              mixins.forEach(function(m){
                m.apply(self, args);
              });
              return returns;
            };
          }
        }
      },
      keypass: keypseudo,
      keyfail: keypseudo,
      delegate: { action: delegateAction },
      within: {
        action: delegateAction,
        onAdd: function(pseudo){
          var condition = pseudo.source.condition;
          if (condition) pseudo.source.condition = function(event, custom){
            return xtag.query(this, pseudo.value).filter(function(node){
              return node == event.target || node.contains ? node.contains(event.target) : null;
            })[0] ? condition.call(this, event, custom) : null;
          };
        }
      },
      preventable: {
        action: function (pseudo, event) {
          return !event.defaultPrevented;
        }
      }
    },

    /* UTILITIES */

    clone: clone,
    typeOf: typeOf,
    toArray: toArray,

    wrap: function (original, fn) {
      return function(){
        var args = arguments,
            output = original.apply(this, args);
        fn.apply(this, args);
        return output;
      };
    },
    /*
      Recursively merges one object with another. The first argument is the destination object,
      all other objects passed in as arguments are merged from right to left, conflicts are overwritten
    */
    merge: function(source, k, v){
      if (typeOf(k) == 'string') return mergeOne(source, k, v);
      for (var i = 1, l = arguments.length; i < l; i++){
        var object = arguments[i];
        for (var key in object) mergeOne(source, key, object[key]);
      }
      return source;
    },

    /*
      ----- This should be simplified! -----
      Generates a random ID string
    */
    uid: function(){
      return Math.random().toString(36).substr(2,10);
    },

    /* DOM */

    query: query,

    skipTransition: function(element, fn, bind){
      var prop = prefix.js + 'TransitionProperty';
      element.style[prop] = element.style.transitionProperty = 'none';
      var callback = fn ? fn.call(bind) : null;
      return xtag.requestFrame(function(){
        xtag.requestFrame(function(){
          element.style[prop] = element.style.transitionProperty = '';
          if (callback) xtag.requestFrame(callback);
        });
      });
    },

    requestFrame: (function(){
      var raf = win.requestAnimationFrame ||
                win[prefix.lowercase + 'RequestAnimationFrame'] ||
                function(fn){ return win.setTimeout(fn, 20); };
      return function(fn){ return raf(fn); };
    })(),

    cancelFrame: (function(){
      var cancel = win.cancelAnimationFrame ||
                   win[prefix.lowercase + 'CancelAnimationFrame'] ||
                   win.clearTimeout;
      return function(id){ return cancel(id); };
    })(),

    matchSelector: function (element, selector) {
      return matchSelector.call(element, selector);
    },

    set: function (element, method, value) {
      element[method] = value;
      if (window.CustomElements) CustomElements.upgradeAll(element);
    },

    innerHTML: function(el, html){
      xtag.set(el, 'innerHTML', html);
    },

    hasClass: function (element, klass) {
      return element.className.split(' ').indexOf(klass.trim())>-1;
    },

    addClass: function (element, klass) {
      var list = element.className.trim().split(' ');
      klass.trim().split(' ').forEach(function (name) {
        if (!~list.indexOf(name)) list.push(name);
      });
      element.className = list.join(' ').trim();
      return element;
    },

    removeClass: function (element, klass) {
      var classes = klass.trim().split(' ');
      element.className = element.className.trim().split(' ').filter(function (name) {
        return name && !~classes.indexOf(name);
      }).join(' ');
      return element;
    },

    toggleClass: function (element, klass) {
      return xtag[xtag.hasClass(element, klass) ? 'removeClass' : 'addClass'].call(null, element, klass);
    },

    /*
      Runs a query on only the children of an element
    */
    queryChildren: function (element, selector) {
      var id = element.id,
        guid = element.id = id || 'x_' + xtag.uid(),
        attr = '#' + guid + ' > ',
        noParent = false;
      if (!element.parentNode){
        noParent = true;
        container.appendChild(element);
      }
      selector = attr + (selector + '').replace(',', ',' + attr, 'g');
      var result = element.parentNode.querySelectorAll(selector);
      if (!id) element.removeAttribute('id');
      if (noParent){
        container.removeChild(element);
      }
      return toArray(result);
    },
    /*
      Creates a document fragment with the content passed in - content can be
      a string of HTML, an element, or an array/collection of elements
    */
    createFragment: function(content) {
      var frag = doc.createDocumentFragment();
      if (content) {
        var div = frag.appendChild(doc.createElement('div')),
          nodes = toArray(content.nodeName ? arguments : !(div.innerHTML = typeof content == 'function' ? parseMultiline(content) : content) || div.children),
          length = nodes.length,
          index = 0;
        while (index < length) frag.insertBefore(nodes[index++], div);
        frag.removeChild(div);
      }
      return frag;
    },

    /*
      Removes an element from the DOM for more performant node manipulation. The element
      is placed back into the DOM at the place it was taken from.
    */
    manipulate: function(element, fn){
      var next = element.nextSibling,
        parent = element.parentNode,
        frag = doc.createDocumentFragment(),
        returned = fn.call(frag.appendChild(element), frag) || element;
      if (next) parent.insertBefore(returned, next);
      else parent.appendChild(returned);
    },

    /* PSEUDOS */

    applyPseudos: function(key, fn, target, source) {
      var listener = fn,
          pseudos = {};
      if (key.match(':')) {
        var split = key.match(regexPseudoSplit),
            i = split.length;
        while (--i) {
          split[i].replace(regexPseudoReplace, function (match, name, value) {
            if (!xtag.pseudos[name]) throw "pseudo not found: " + name + " " + split;
            value = (value === '' || typeof value == 'undefined') ? null : value;
            var pseudo = pseudos[i] = Object.create(xtag.pseudos[name]);
            pseudo.key = key;
            pseudo.name = name;
            pseudo.value = value;
            pseudo['arguments'] = (value || '').split(',');
            pseudo.action = pseudo.action || trueop;
            pseudo.source = source;
            var last = listener;
            listener = function(){
              var args = toArray(arguments),
                  obj = {
                    key: key,
                    name: name,
                    value: value,
                    source: source,
                    'arguments': pseudo['arguments'],
                    listener: last
                  };
              var output = pseudo.action.apply(this, [obj].concat(args));
              if (output === null || output === false) return output;
              return obj.listener.apply(this, args);
            };
            if (target && pseudo.onAdd) {
              if (target.nodeName) pseudo.onAdd.call(target, pseudo);
              else target.push(pseudo);
            }
          });
        }
      }
      for (var z in pseudos) {
        if (pseudos[z].onCompiled) listener = pseudos[z].onCompiled(listener, pseudos[z]) || listener;
      }
      return listener;
    },

    removePseudos: function(target, pseudos){
      pseudos.forEach(function(obj){
        if (obj.onRemove) obj.onRemove.call(target, obj);
      });
    },

  /*** Events ***/

    parseEvent: function(type, fn) {
      var pseudos = type.split(':'),
          key = pseudos.shift(),
          custom = xtag.customEvents[key],
          event = xtag.merge({
            type: key,
            stack: noop,
            condition: trueop,
            attach: [],
            _attach: [],
            pseudos: '',
            _pseudos: [],
            onAdd: noop,
            onRemove: noop
          }, custom || {});
      event.attach = toArray(event.base || event.attach);
      event.chain = key + (event.pseudos.length ? ':' + event.pseudos : '') + (pseudos.length ? ':' + pseudos.join(':') : '');
      var condition = event.condition;
      event.condition = function(e){
        var t = e.touches, tt = e.targetTouches;
        return condition.apply(this, arguments);
      };
      var stack = xtag.applyPseudos(event.chain, fn, event._pseudos, event);
      event.stack = function(e){
        e.currentTarget = e.currentTarget || this;
        var t = e.touches, tt = e.targetTouches;
        var detail = e.detail || {};
        if (!detail.__stack__) return stack.apply(this, arguments);
        else if (detail.__stack__ == stack) {
          e.stopPropagation();
          e.cancelBubble = true;
          return stack.apply(this, arguments);
        }
      };
      event.listener = function(e){
        var args = toArray(arguments),
            output = event.condition.apply(this, args.concat([event]));
        if (!output) return output;
        // The second condition in this IF is to address the following Blink regression: https://code.google.com/p/chromium/issues/detail?id=367537
        // Remove this when affected browser builds with this regression fall below 5% marketshare
        if (e.type != key && (e.baseEvent && e.type != e.baseEvent.type)) {
          xtag.fireEvent(e.target, key, {
            baseEvent: e,
            detail: output !== true && (output.__stack__ = stack) ? output : { __stack__: stack }
          });
        }
        else return event.stack.apply(this, args);
      };
      event.attach.forEach(function(name) {
        event._attach.push(xtag.parseEvent(name, event.listener));
      });
      if (custom && custom.observe && !custom.__observing__) {
        custom.observer = function(e){
          var output = event.condition.apply(this, toArray(arguments).concat([custom]));
          if (!output) return output;
          xtag.fireEvent(e.target, key, {
            baseEvent: e,
            detail: output !== true ? output : {}
          });
        };
        for (var z in custom.observe) xtag.addEvent(custom.observe[z] || document, z, custom.observer, true);
        custom.__observing__ = true;
      }
      return event;
    },

    addEvent: function (element, type, fn, capture) {
      var event = typeof fn == 'function' ? xtag.parseEvent(type, fn) : fn;
      event._pseudos.forEach(function(obj){
        obj.onAdd.call(element, obj);
      });
      event._attach.forEach(function(obj) {
        xtag.addEvent(element, obj.type, obj);
      });
      event.onAdd.call(element, event, event.listener);
      element.addEventListener(event.type, event.stack, capture || xtag.captureEvents.indexOf(event.type) > -1);
      return event;
    },

    addEvents: function (element, obj) {
      var events = {};
      for (var z in obj) {
        events[z] = xtag.addEvent(element, z, obj[z]);
      }
      return events;
    },

    removeEvent: function (element, type, event) {
      event = event || type;
      event.onRemove.call(element, event, event.listener);
      xtag.removePseudos(element, event._pseudos);
      event._attach.forEach(function(obj) {
        xtag.removeEvent(element, obj);
      });
      element.removeEventListener(event.type, event.stack);
    },

    removeEvents: function(element, obj){
      for (var z in obj) xtag.removeEvent(element, obj[z]);
    },

    fireEvent: function(element, type, options, warn){
      var event = doc.createEvent('CustomEvent');
      options = options || {};
      if (warn) console.warn('fireEvent has been modified');
      event.initCustomEvent(type,
        options.bubbles !== false,
        options.cancelable !== false,
        options.detail
      );
      if (options.baseEvent) inheritEvent(event, options.baseEvent);
      try { element.dispatchEvent(event); }
      catch (e) {
        console.warn('This error may have been caused by a change in the fireEvent method', e);
      }
    },

    /*
      Listens for insertion or removal of nodes from a given element using
      Mutation Observers, or Mutation Events as a fallback
    */
    addObserver: function(element, type, fn){
      if (!element._records) {
        element._records = { inserted: [], removed: [] };
        if (mutation){
          element._observer = new mutation(function(mutations) {
            parseMutations(element, mutations);
          });
          element._observer.observe(element, {
            subtree: true,
            childList: true,
            attributes: !true,
            characterData: false
          });
        }
        else ['Inserted', 'Removed'].forEach(function(type){
          element.addEventListener('DOMNode' + type, function(event){
            event._mutation = true;
            element._records[type.toLowerCase()].forEach(function(fn){
              fn(event.target, event);
            });
          }, false);
        });
      }
      if (element._records[type].indexOf(fn) == -1) element._records[type].push(fn);
    },

    removeObserver: function(element, type, fn){
      var obj = element._records;
      if (obj && fn){
        obj[type].splice(obj[type].indexOf(fn), 1);
      }
      else{
        obj[type] = [];
      }
    }

  };

/*** Universal Touch ***/

var touching = false,
    touchTarget = null;

doc.addEventListener('mousedown', function(e){
  touching = true;
  touchTarget = e.target;
}, true);

doc.addEventListener('mouseup', function(){
  touching = false;
  touchTarget = null;
}, true);

doc.addEventListener('dragend', function(){
  touching = false;
  touchTarget = null;
}, true);

var UIEventProto = {
  touches: {
    configurable: true,
    get: function(){
      return this.__touches__ ||
        (this.identifier = 0) ||
        (this.__touches__ = touching ? [this] : []);
    }
  },
  targetTouches: {
    configurable: true,
    get: function(){
      return this.__targetTouches__ || (this.__targetTouches__ =
        (touching && this.currentTarget &&
        (this.currentTarget == touchTarget ||
        (this.currentTarget.contains && this.currentTarget.contains(touchTarget)))) ? (this.identifier = 0) || [this] : []);
    }
  },
  changedTouches: {
    configurable: true,
    get: function(){
      return this.__changedTouches__ || (this.identifier = 0) || (this.__changedTouches__ = [this]);
    }
  }
};

for (z in UIEventProto){
  UIEvent.prototype[z] = UIEventProto[z];
  Object.defineProperty(UIEvent.prototype, z, UIEventProto[z]);
}


/*** Custom Event Definitions ***/

  function addTap(el, tap, e){
    if (!el.__tap__) {
      el.__tap__ = { click: e.type == 'mousedown' };
      if (el.__tap__.click) el.addEventListener('click', tap.observer);
      else {
        el.__tap__.scroll = tap.observer.bind(el);
        window.addEventListener('scroll', el.__tap__.scroll, true);
        el.addEventListener('touchmove', tap.observer);
        el.addEventListener('touchcancel', tap.observer);
        el.addEventListener('touchend', tap.observer);
      }
    }
    if (!el.__tap__.click) {
      el.__tap__.x = e.touches[0].pageX;
      el.__tap__.y = e.touches[0].pageY;
    }
  }

  function removeTap(el, tap){
    if (el.__tap__) {
      if (el.__tap__.click) el.removeEventListener('click', tap.observer);
      else {
        window.removeEventListener('scroll', el.__tap__.scroll, true);
        el.removeEventListener('touchmove', tap.observer);
        el.removeEventListener('touchcancel', tap.observer);
        el.removeEventListener('touchend', tap.observer);
      }
      delete el.__tap__;
    }
  }

  function checkTapPosition(el, tap, e){
    var touch = e.changedTouches[0],
        tol = tap.gesture.tolerance;
    if (
      touch.pageX < el.__tap__.x + tol &&
      touch.pageX > el.__tap__.x - tol &&
      touch.pageY < el.__tap__.y + tol &&
      touch.pageY > el.__tap__.y - tol
    ) return true;
  }

  xtag.customEvents.tap = {
    observe: {
      mousedown: document,
      touchstart: document
    },
    gesture: {
      tolerance: 8
    },
    condition: function(e, tap){
      var el = e.target;
      switch (e.type) {
        case 'touchstart':
          if (el.__tap__ && el.__tap__.click) removeTap(el, tap);
          addTap(el, tap, e);
          return;
        case 'mousedown':
          if (!el.__tap__) addTap(el, tap, e);
          return;
        case 'scroll':
        case 'touchcancel':
          removeTap(this, tap);
          return;
        case 'touchmove':
        case 'touchend':
          if (this.__tap__ && !checkTapPosition(this, tap, e)) {
            removeTap(this, tap);
            return;
          }
          return e.type == 'touchend' || null;
        case 'click':
          removeTap(this, tap);
          return true;
      }
    }
  };

  win.xtag = xtag;
  if (typeof define == 'function' && define.amd) define(xtag);

  doc.addEventListener('WebComponentsReady', function(){
    xtag.fireEvent(doc.body, 'DOMComponentsLoaded');
  });

})();




(function(){

  var template = '<div class="x-grow-wrap" onresize="this.parentNode.matchDimensions.call(this.parentNode)">' +
        '<div class="x-grow-content"></div>' +
        '<div class="x-grow-overflow"><div></div></div>' +
        '<div class="x-grow-underflow"><div></div></div>' +
      '</div>';

  xtag.register('x-growbox', {
    lifecycle: {
      created: function(){
        var children = xtag.toArray(this.children);
        var frag = xtag.createFragment(template);
        var content = frag.querySelector('.x-grow-content');
        children.forEach(function(el){
          content.appendChild(el);
        });
        this.appendChild(frag);
        xtag.addEvent(this.firstElementChild.firstElementChild.nextElementSibling, 'overflow', this.matchDimensions.bind(this));
        xtag.addEvent(this.firstElementChild.lastElementChild, 'underflow', this.matchDimensions.bind(this));
        this.matchDimensions();
      }
    },
    methods: {
      matchDimensions: function(resize){
        var wrap = this.firstElementChild;
        if (!wrap || wrap.className != 'x-grow-wrap') return false;
        this.style.height = (resize === true) ? window.getComputedStyle(wrap).height : wrap.scrollHeight + 'px';
        wrap.firstElementChild.nextElementSibling.firstChild.style.height = wrap.scrollHeight - 1 + 'px';
        wrap.lastElementChild.firstChild.style.height = wrap.scrollHeight + 1 + 'px';
      }
    },
    events:{
      'overflow': function(){
        this.matchDimensions();
      },
      'underflow': function(){
        this.matchDimensions();
      }
    }
  });

})();
(function(){

  function getLayoutScroll(layout, element){
    var scroll = element.__layoutScroll__ = element.__layoutScroll__ || Object.defineProperty(element, '__layoutScroll__', {
      value: {
        last: element.scrollTop
      }
    }).__layoutScroll__;
    var now = element.scrollTop,
        buffer = layout.scrollBuffer;
    scroll.max = scroll.max || Math.max(now + buffer, buffer);
    scroll.min = scroll.min || Math.max(now - buffer, buffer);
    return scroll;
  }

  function maxContent(layout){
    layout.setAttribute('content-maximizing', null);
  }

  function minContent(layout){
    layout.removeAttribute('content-maximized');
    layout.removeAttribute('content-maximizing');
  }

  function evaluateScroll(event){
    var layout = event.currentTarget;
    if (layout.hideTrigger == 'scroll' && !event.currentTarget.hasAttribute('content-maximizing')) {

      var target = event.target;
      if (layout.scrollTarget ? xtag.matchSelector(target, layout.scrollTarget) : target.parentNode == layout){
        var now = target.scrollTop,
            buffer = layout.scrollBuffer,
            scroll = getLayoutScroll(layout, target);

        if (now > scroll.last) {
          scroll.min = Math.max(now - buffer, buffer);
        } else if (now < scroll.last) {
          scroll.max = Math.max(now + buffer, buffer);
        }

        if (!layout.maxcontent) {
          if (now > scroll.max && !layout.hasAttribute('content-maximized')) {
            maxContent(layout);
          } else if (now < scroll.min) {
            minContent(layout);
          }
        }

        scroll.last = now;
      }
    }
  }

  xtag.register('x-layout', {
    events: {
      scroll: evaluateScroll,
      transitionend: function(e){
        var node = e.target;
        if (this.hasAttribute('content-maximizing') && node.parentNode == this && (node.nodeName.toLowerCase() == 'header' || node.nodeName.toLowerCase() == 'footer')) {
          this.setAttribute('content-maximized', null);
          this.removeAttribute('content-maximizing');
        }
      },
      'tap:delegate(section)': function(e){
        var layout = e.currentTarget;
        if (layout.hideTrigger == 'tap' && !layout.maxcontent && this.parentNode == layout) {
          if ((layout.hasAttribute('content-maximizing') || layout.hasAttribute('content-maximized'))) {
            minContent(layout);
          } else {
            maxContent(layout);
          }
        }
      },
      'mouseout': function(e){
        if (this.hideTrigger == 'hover' && !this.maxcontent && !this.hasAttribute('content-maximized') && (!e.relatedTarget || !this.contains(e.relatedTarget))) {
          maxContent(this);
        }
      },
      'mouseover': function(e){
        if (this.hideTrigger == 'hover' && !this.maxcontent && (this.hasAttribute('content-maximized') || this.hasAttribute('content-maximizing')) && (this == e.relatedTarget || !this.contains(e.relatedTarget))) {
          minContent(this);
        }
      }
    },
    accessors: {
      scrollTarget: {
        attribute: { name: 'scroll-target' }
      },
      scrollBuffer: {
        attribute: { name: 'scroll-buffer' },
        get: function(){
          return Number(this.getAttribute('scroll-buffer')) || 80;
        }
      },
      hideTrigger: {
        attribute: { name: 'hide-trigger' }
      },
      maxcontent: {
        attribute: { boolean: true },
        set: function(value){
          if (value) {
            maxContent(this);
          } else if (!this.hasAttribute('content-maximizing')) {
            minContent(this);
          }
        }
      }
    }
  });

})();



(function(){

  var delayedEvents = [],
    fireMatches = function(element, mql, attr, skipFire){
      var state = (mql.matches) ? ['active', 'set', 'add'] : ['inactive', 'remove', 'remove'],
        eventType = 'mediaquery' + state[0],
        eventData = { 'query': mql };
      element[state[1] + 'Attribute']('matches', null);
      if (!skipFire) xtag.fireEvent(element, eventType, eventData);
      (attr || (element.getAttribute('for') || '').split(' ')).forEach(function(id){
        var node = document.getElementById(id);
        if (node) {
          xtag[state[2] + 'Class'](node, element.id);
          if (!skipFire) xtag.fireEvent(node, eventType, eventData, { bubbles: false });
        }
      });
    },
    attachQuery = function(element, query, attr, skipFire){
      if (!/in/.test(document.readyState)){
        skipFire = true;
        if (delayedEvents.indexOf(element) == -1){
          delayedEvents.push(element);
        }
      }
      query = query || element.getAttribute('media');
      if (query){
        if (element.xtag.query) element.xtag.query.removeListener(element.xtag.listener);
        query = element.xtag.query = window.matchMedia(query);
        var listener = element.xtag.listener = function(mql){
          fireMatches(element, mql);
        };
        fireMatches(element, query, attr, skipFire);
        query.addListener(listener);
      }
    },
    delayedListener = function(){
      delayedEvents = delayedEvents.map(function(element){
        return attachQuery(element);
      });
      document.removeEventListener('DOMComponentsLoaded', delayedListener);
    };

  document.addEventListener('DOMComponentsLoaded', delayedListener);

  xtag.register('x-mediaquery', {
    accessors:{
      'for': {
        get: function(){
          return this.getAttribute('for');
        },
        set: function(value){
          var next = (value || '').split(' ');
          (this.getAttribute('for') || '').split(' ').map(function(id){
            var index = next.indexOf(id);
            if (index == -1){
              var element = document.getElementById(id);
              if (element){
                xtag.removeClass(element, this.id);
                xtag.fireEvent(element, 'mediaqueryremoved');
              }
            }
            else next.splice(index, 1);
          }, this);
          attachQuery(this, null, next);
        }
      },
      'media': {
        attribute: {},
        get: function(){
          return this.getAttribute('media');
        },
        set: function(query){
          attachQuery(this, query);
        }
      },
      'id': {
        attribute: {},
        get: function(){
          return this.getAttribute('id');
        },
        set: function(value){
          var current = this.getAttribute('id');
          xtag.query(document, '.' + current).forEach(function(node){
            xtag.removeClass(node, current);
            xtag.addClass(node, value);
          });
        }
      }
    }
  });

})();

(function(){

  var events = {},
      elements = {},
      observers = {};

  function outerNodes(element, event){
    var type = event.type,
        el = elements[type] || (elements[type] = []),
        ev = events[type] || (events[type] = []),
        i = el.indexOf(element);
    if (i == -1) {
      el.push(element);
      ev.push(event);
    }
    else {
      el.splice(i, 1);
      ev.splice(i, 1);
    }
    return el;
  }

  xtag.pseudos.outer = {
    action: function(pseudo, e){
      if (this == e.target || this.contains && this.contains(e.target)) return null;
    },
    onRemove: function(pseudo){
      if (!outerNodes(this, pseudo.source).length) {
        xtag.removeEvent(document, observers[pseudo.source.type]);
      }
    },
    onAdd: function(pseudo){
      outerNodes(this, pseudo.source);
      var element = this,
          type = pseudo.source.type;
      if (!observers[type]) {
        observers[type] = xtag.addEvent(document, type, function(e){
          elements[type].forEach(function(node, i){
            if (node == e.target || node.contains(e.target)) return;
            events[type][i].stack.call(node, e);
          });
        });
      }
    }
  };

})();

(function(){

  var matchNum = /[1-9]/,
      replaceSpaces = / /g,
      captureTimes = /(\d|\d+?[.]?\d+?)(s|ms)(?!\w)/gi,
      transPre = 'transition' in getComputedStyle(document.documentElement) ? 't' : xtag.prefix.js + 'T',
      transDur = transPre + 'ransitionDuration',
      transProp = transPre + 'ransitionProperty',
      skipFrame = function(fn){
        xtag.requestFrame(function(){ xtag.requestFrame(fn) });
      },
      ready = document.readyState == 'complete' ?
        skipFrame(function(){ ready = false }) :
        xtag.addEvent(document, 'readystatechange', function(){
          if (document.readyState == 'complete') {
            skipFrame(function(){ ready = false });
            xtag.removeEvent(document, 'readystatechange', ready);
          }
        });

  function getTransitions(node){
    return node.__transitions__ = node.__transitions__ || {};
  }

  function startTransition(node, name, transitions){
    var style = getComputedStyle(node),
        after = transitions[name].after;
    node.setAttribute('transition', name);
    if (after && !style[transDur].match(matchNum)) after();
  }

  xtag.addEvents(document, {
    transitionend: function(e){
      var node = e.target,
          name = node.getAttribute('transition');
      if (name) {
        var i = max = 0,
            prop = null,
            style = getComputedStyle(node),
            transitions = getTransitions(node),
            props = style[transProp].replace(replaceSpaces, '').split(',');
        style[transDur].replace(captureTimes, function(match, time, unit){
          var time = parseFloat(time) * (unit === 's' ? 1000 : 1);
          if (time > max) prop = i, max = time;
          i++;
        });
        prop = props[prop];
        if (!prop) throw new SyntaxError('No matching transition property found');
        else if (e.propertyName == prop && transitions[name].after) transitions[name].after();
      }
    }
  });

  xtag.transition = function(node, name, obj){
    var transitions = getTransitions(node),
        options = transitions[name] = obj || {};
    if (options.immediate) options.immediate();
    if (options.before) {
      options.before();
      if (ready) xtag.skipTransition(node, function(){
        startTransition(node, name, transitions);
      });
      else skipFrame(function(){
        startTransition(node, name, transitions);
      });
    }
    else startTransition(node, name, transitions);
  };

  xtag.pseudos.transition = {
    onCompiled: function(fn, pseudo){
      var options = {},
          when = pseudo.arguments[0] || 'immediate',
          name = pseudo.arguments[1] || pseudo.key.split(':')[0];
      return function(){
        var target = this, args = arguments;
        if (this.hasAttribute('transition')) {
          options[when] = function(){
            return fn.apply(target, args);
          }
          xtag.transition(this, name, options);
        }
        else return fn.apply(this, args);
      }
    }
  }

})();

import xtag from './xtag';
let Elements = {};

export class Registry {

	static register(tagName, controllerType, options){
		return Elements[controllerType.name] = xtag.register(tagName, ControllerConnector.connect(controllerType, options));
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
                    templatePromise = this.controller.attachingTemplate(template);
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