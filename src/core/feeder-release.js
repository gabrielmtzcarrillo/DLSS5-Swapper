'use strict';

// Current verified Feeder release. Older payloads remain installable through
// their existing folders, but new installs use this release.
const CURRENT = {
  version: '0.15.1',
  archive: ['DLSS5-Feeder-0.15.1.zip', 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/download/v0.15.1/DLSS5-Feeder-0.15.1.zip', '2e44e81e691e75e532b9b7babc278a12615cb7f0fd9ef854da50e6ef17b272f4'],
  addon64Size: 297472,
  hashes: {
    'dlss5-feed.addon32': 'fb69357075cba536b42f2e693992fde0c1775058b1fd9f10fbdf1e7eba3443e7',
    'dlss5-feed.addon64': '3afc8efb5f516e94a2a068b2e90eaed360d1e30ca2c29b623e0cfadc1f05d50d',
    'dlss5-feed-host64.exe': '034e6cdf382e6ea9164afd63c5b8a8aa0312894cb342593bc933e9fa435f8d02',
    'reshade-shaders/Shaders/DLSS5_Feed.fx': 'cdac08a721b14b97187dd86c5b5bead157c9063d7ee859a0f131a8ee791695f1',
    'layer-x64/VkLayer_feed_vk.dll': 'a789badd4bb43eb26d694d347d8b17cc57c36006154fbb677c08e5e9c713984e',
    'layer-x64/VkLayer_feed_vk.json': 'c15967b3f8847a145e21058a1e57e92c595ee17fc5dd23ab3278b0148ad6e9d1',
    'layer-x64/run-with-feed-layer.bat': 'bc9aa7964742e23653556be978f540f503f3cef928b6de7a38f77c570bb764f9',
    'layer-x86/VkLayer_feed_vk32.dll': '7ed337ff071cf8c94408c90c8d4fea796436fc8a0335e6017632ec57536d9c42',
    'layer-x86/VkLayer_feed_vk32.json': '28f8174eb8fed02266bafa6910eab07922ec6d2bdb33110699c586f74b254921',
    'layer-x86/run-with-feed-layer32.bat': '75d4584ad01619402a10e0d8342b114613057a1d3b0ac8dbe9280b740090c3e8'
  }
};

// Keep the previous verified releases selectable for existing payloads.
module.exports = CURRENT;
module.exports.VERSIONS = [CURRENT,
  { version: '0.12.0', archive: ['DLSS5-Feeder-0.12.0.zip', 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/download/v0.12.0/DLSS5-Feeder-0.12.0.zip', 'e970537996f6e73dce9a510b9e015fad19f148ee736dc4f518ccdebf6f012558'], hashes: {
    'dlss5-feed.addon32': 'd2df9fbf9b5e0cc24291b9240e4f8dd2aae063592571bbed37302878b6dac74c', 'dlss5-feed.addon64': '066eec8c797df2d656f2ab2324278921b1dd6e9116c9945294f4a00f7fec608a', 'dlss5-feed-host64.exe': '397dbf49c3a2b5f3bc13cfa0e0b3df4316edae9c45be7379bcacad066ebb07f2', 'reshade-shaders/Shaders/DLSS5_Feed.fx': '955d911d3b567c57f4e0b44e528dae3f3df286fd8fd3e775b9f6b5ddd561aa94'
  } },
  { version: '0.13.1-beta.1', archive: ['DLSS5-Feeder-0.13.1-beta.1.zip', 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/download/v0.13.1-beta.1/DLSS5-Feeder-0.13.1-beta.1.zip', '8da626ed906a29289f001cb613640015360e36b0c3478348bf097a304b34bb18'], hashes: {
    'dlss5-feed.addon32': '46586421a0097a8ad57d14d45a66331011ee38196856e6c906808bee8756beda', 'dlss5-feed.addon64': 'f01233a44f46d770cfce58b6cb9751038ccf55695aaee8133dfa850398ae9934f', 'dlss5-feed-host64.exe': '896cd4b3f0ebbe0054b6284c146c915e2f123b9b12f6eea6ab7169b01aa8a9d3', 'reshade-shaders/Shaders/DLSS5_Feed.fx': '491815122018d17d460f02adc0e5f03abb6e7489e3b8136ba003927ee06858e9'
  } },
  { version: '0.14.0-beta.4', archive: ['DLSS5-Feeder-0.14.0-beta.4.zip', 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/download/v0.14.0-beta.4/DLSS5-Feeder-0.14.0-beta.4.zip', '7ee5d63e0674129e263d991c167466ea38909ff9358c2f07eb02a13cef70933f'], hashes: {
    'dlss5-feed.addon32': '0da474f208ce9b38a0bb9025b789f4169bf1a86c72a5c853a77ac816318f0d77', 'dlss5-feed.addon64': '03545edcca1153f27cecb7ade8cd9a0420370748ae54e55e83119bec0c5075f1', 'dlss5-feed-host64.exe': '3ed3ab48691ae1120867a4dc21ef6d85a6c8d4fd4d22f20400213f1f918e5e26', 'reshade-shaders/Shaders/DLSS5_Feed.fx': 'cdac08a721b14b97187dd86c5b5bead157c9063d7ee859a0f131a8ee791695f1'
  } }
];
module.exports.release = version => module.exports.VERSIONS.find(item => item.version === version) || CURRENT;
module.exports.supportsDx10 = version => {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actual = match.slice(1).map(Number), required = [0, 13, 1];
  for (let i = 0; i < required.length; i++) if (actual[i] !== required[i]) return actual[i] > required[i];
  return true;
};
