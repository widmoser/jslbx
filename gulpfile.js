var gulp = require('gulp');
var ts = require('gulp-typescript');
var createTemplateCache = require('gulp-angular-templatecache');
var concat = require('gulp-concat');
var less = require('gulp-less');
var streamqueue = require('streamqueue');

gulp.task('default', ['build']);

gulp.task('watch', function() {
  return gulp.watch('src/**', ['build'])
});

gulp.task('build', ['compile', 'less']);

gulp.task('less', function() {
  return gulp.src('src/**/*.less')
    .pipe(less())
    .pipe(gulp.dest('dist'));
});

gulp.task('compile', function () {
  return gulp.src('src/**/*.ts')
    .pipe(ts({
      //noImplicitAny: true
    }))
    .pipe(concat('jslbx.js'))
    .pipe(gulp.dest('dist'));
});