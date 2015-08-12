var gulp = require('gulp');
var runSequence = require('run-sequence');
var changed = require('gulp-changed');
var plumber = require('gulp-plumber');
var sourcemaps = require('gulp-sourcemaps');
var to5 = require('gulp-babel');
var paths = require('../paths');
var compilerOptions = require('../babel-options');
var assign = Object.assign || require('object.assign');
var through2 = require('through2');
var concat = require('gulp-concat');
var insert = require('gulp-insert');
var rename = require('gulp-rename');
var tools = require('aurelia-tools');
var less = require('gulp-less');

var jsName = paths.packageName + '.js';

console.log('js name:' + jsName);

gulp.task('build-index', function () {
    var importsToAdd = [];
    var files = ['x-tag-lib.js','xtag.js','controllerConnector.js', 'registry.js'].map(function (file) {
        return paths.root + file;
    });

    return gulp.src(files)
        .pipe(through2.obj(function (file, enc, callback) {
            file.contents = new Buffer(tools.extractImports(file.contents.toString("utf8"), importsToAdd));
            this.push(file);
            return callback();
        }))
        .pipe(concat(jsName))
        .pipe(insert.transform(function (contents) {
            return tools.createImportBlock(importsToAdd) + contents;
        }))
        .pipe(gulp.dest(paths.output));
});

gulp.task('build-es6', function () {
    return gulp.src(paths.output + jsName)
        .pipe(gulp.dest(paths.output + 'es6'));
});

gulp.task('build-commonjs', function () {
    return gulp.src(paths.output + jsName)
        .pipe(to5(assign({}, compilerOptions, {
            modules: 'common'
        })))
        .pipe(gulp.dest(paths.output + 'commonjs'));
});

gulp.task('build-amd', function () {
    return gulp.src(paths.output + jsName)
        .pipe(to5(assign({}, compilerOptions, {
            modules: 'amd'
        })))
        .pipe(gulp.dest(paths.output + 'amd'));
});

gulp.task('build-system', function () {
    return gulp.src(paths.output + jsName)
        .pipe(to5(assign({}, compilerOptions, {
            modules: 'system'
        })))
        .pipe(gulp.dest(paths.output + 'system'));
});


// copies changed html files to the output directory
gulp.task('build-html', function () {
    return gulp.src(paths.html)
        .pipe(changed(paths.output, {
            extension: '.html'
        }))
        .pipe(gulp.dest(paths.output));
});

gulp.task('build-less', function () {
    return gulp.src('./src/less/components/*.less')
        .pipe(less())
        .pipe(gulp.dest('./styles/components'));
});


gulp.task('build-dts', function () {
    return gulp.src(paths.output + 'index.d.ts')
        .pipe(rename(paths.packageName + '.d.ts'))
        .pipe(gulp.dest(paths.output + 'es6'))
        .pipe(gulp.dest(paths.output + 'commonjs'))
        .pipe(gulp.dest(paths.output + 'amd'))
        .pipe(gulp.dest(paths.output + 'system'));
});

gulp.task('build', function (callback) {
    return runSequence(
        'clean',
        'build-index', ['build-es6', 'build-commonjs', 'build-amd', 'build-system' ],
        'build-dts',
        callback
    );
});
