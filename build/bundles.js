module.exports = {
  "bundles": {   
    "dist/asanjs-registry": {
      "includes": [
        "x-tag",
        "dist/controllerConnector",
        "dist/registry"      
      ],
      "options": {
        "inject": true,
        "minify": false,
        "depCache": false,
        "rev": false
      }
    }
  }
};
