# trip

[![NPM version][npm-image]][npm-url] [![Linux Build Status][travis-image]][travis-url] [![Windows Build Status][appveyor-image]][appveyor-url] [![Dependency Status][depstat-image]][depstat-url] [![devDependency Status][devdepstat-image]][devdepstat-url] [![peerDependency Status][peerdepstat-image]][peerdepstat-url]

A minimalist task runner for Node.js.

## Install

```sh
> npm install -g trip
```

(Or install it locally for your project with `--save-dev`, if you prefer.)

## Usage

1. Make a `tripfile.js` and `export` some functions from it.
2. Run the named functions from your CLI using `trip NAME`.

Notes:

- You can use ES2016 syntax and it will just work ([see below](#ES2015)).
- Your functions may take a `flags` object as the first argument, allowing you to set simple boolean flags from the command line ([see below](#Flags)).
- For compatibility with old callback-style APIs, you may also take a `done` callback as a second argument, if you really have to.
- You can run multiple tasks in series like this: `> trip task1 task2 task3`

### Example tripfile.js

There's no need to import anything or register anything – just `export` some functions:

```js
// simple task - runs with `trip speak`
export function speak() {
	console.log('Hello world!');
}

// do something async
export async function wow() {
	await somePromise();
}
```

### Flags

You can pass simple boolean flags from the command line using `:` as a delimiter.

For example, the command `> trip foo:bar:baz` will call the `foo` function with the flags `{bar: true, baz: true}`.

```js
// run this with `trip speak:leaving:polite` to set enable the flag
export function speak({ leaving }) {
	console.log((leaving ? 'Goodbye' : 'Hello') + ' world!');
}
```

## ES2016

Your tripfile is automatically compiled with Babel. Trip uses the [es2015](https://babeljs.io/docs/plugins/preset-es2015/) and [stage-0](https://babeljs.io/docs/plugins/preset-stage-0/) presets by default, so you don't need to bring your own Babel config. But if you do have your own config in a `.babelrc` or `package.json`, Babel will use that instead.

---

## License

[MIT](./LICENSE) © [Callum Locke](https://twitter.com/callumlocke)

<!-- badge URLs -->
[npm-url]: https://npmjs.org/package/trip
[npm-image]: https://img.shields.io/npm/v/trip.svg?style=flat-square

[travis-url]: https://travis-ci.org/tripjs/trip
[travis-image]: https://img.shields.io/travis/tripjs/trip.svg?style=flat-square&label=Linux

[appveyor-url]: https://ci.appveyor.com/project/callumlocke/trip
[appveyor-image]: https://img.shields.io/appveyor/ci/callumlocke/trip/master.svg?style=flat-square&label=Windows

[depstat-url]: https://david-dm.org/tripjs/trip
[depstat-image]: https://img.shields.io/david/tripjs/trip.svg?style=flat-square

[devdepstat-url]: https://david-dm.org/tripjs/trip#info=devDependencies
[devdepstat-image]: https://img.shields.io/david/dev/tripjs/trip.svg?style=flat-square&label=devDeps

[peerdepstat-url]: https://david-dm.org/tripjs/trip#info=peerDependencies
[peerdepstat-image]: https://img.shields.io/david/peer/tripjs/trip.svg?style=flat-square&label=peerDeps
