import { delay } from 'bluebird';
import gulp from 'gulp';

export async function greet({ leaving }) {
	console.log(leaving ? 'Goodbye,' : 'Hello,');

	await delay(200);
	console.log('world!');
}

export function oldSchool({ shouldFail }, done) {
	delay(400).then(() => {
		console.log('about to call back');

		if (shouldFail) done(new Error('failed'));
		else done();
	});
}

export function streamy() {
	return gulp.src('foo/**/*.css').pipe(gulp.dest('tmp'));
}

export default function () {
	console.log('this is the default task');
}
