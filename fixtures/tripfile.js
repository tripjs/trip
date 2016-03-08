import { delay } from 'bluebird';

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

export default function () {
	console.log('this is the default task');
}
