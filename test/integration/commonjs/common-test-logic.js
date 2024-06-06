/** @param {import('promptfoo')} */
function runTests(promptfooModule) {
  const availableProviders = Object.keys(promptfooModule.providers);
  if (availableProviders.length < 8) {
    throw new Error(`Missing providers. Expected there to be many, but got: ${availableProviders}`);
  }
}

module.exports = { runTests };
