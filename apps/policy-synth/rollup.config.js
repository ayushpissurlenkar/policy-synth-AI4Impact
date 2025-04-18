import copy from 'rollup-plugin-copy';
import nodeResolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import html from '@web/rollup-plugin-html';
import { importMetaAssets } from '@web/rollup-plugin-import-meta-assets';
import { terser } from 'rollup-plugin-terser';
//import { generateSW } from 'rollup-plugin-workbox';
//import analyze from 'rollup-plugin-analyzer';
import replace from '@rollup/plugin-replace';
import pkg from './package.json';
const commonjs = require('rollup-plugin-commonjs');

function getCustomVersion(version) {
  const date = new Date();

  const formattedDate = date.toLocaleString('en-US', {
    hour12: false,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });

  return `Built on ${formattedDate}`;
}

export default {
  input: 'index.html',
  output: {
    entryFileNames: '[hash].js',
    chunkFileNames: '[hash].js',
    assetFileNames: '[hash][extname]',
    format: 'es',
    dir: 'dist',
  },
  preserveEntrySignatures: false,

  plugins: [
    commonjs(),

    /** Enable using HTML as rollup entrypoint */
    html({
      minify: false,
      //        publicPath: '/'
      //      injectServiceWorker: true,
      //      serviceWorkerPath: 'dist/sw.js',
    }),
    copy({
      targets: [{ src: 'locales', dest: 'dist/' }],
    }),
    /** Resolve bare module imports */
    nodeResolve(),
    /** Minify JS */
    terser(),
    /** Bundle assets references via import.meta.url */
    importMetaAssets(),
    /** Compile JS to a lower language target */
    babel({
      babelHelpers: 'bundled',
      presets: [
        [
          require.resolve('@babel/preset-env'),
          {
            targets: [
              'last 3 Chrome major versions',
              'last 3 Firefox major versions',
              'last 3 Edge major versions',
              'last 3 Safari major versions',
            ],
            modules: false,
            bugfixes: true,
          },
        ],
      ],
      plugins: [
        [
          require.resolve('babel-plugin-template-html-minifier'),
          {
            modules: { lit: ['html', { name: 'css', encapsulation: 'style' }] },
            failOnError: false,
            strictCSS: true,
            htmlMinifier: {
              collapseWhitespace: true,
              conservativeCollapse: true,
              removeComments: true,
              caseSensitive: true,
              minifyCSS: true,
            },
          },
        ],
      ],
    }),
    replace({
      preventAssignment: true,
      __VERSION__: getCustomVersion(pkg.version),
    }),
    //analyze({summaryOnly: true})
    /** Create and inject a service worker */
    //generateSW({
    //  globIgnores: ['polyfills/*.js', 'nomodule-*.js'],
    //  navigateFallback: '/index.html',
    // where to output the generated sw
    //  swDest: path.join('dist', 'sw.js'),
    // directory to match patterns against to be precached
    //  globDirectory: path.join('dist'),
    // cache any html js and css by default
    //   globPatterns: ['**/*.{html,js,css,webmanifest}'],
    //   skipWaiting: true,
    //   clientsClaim: true,
    //  runtimeCaching: [{ urlPattern: 'polyfills/*.js', handler: 'CacheFirst' }],
    //}),
  ],
};
