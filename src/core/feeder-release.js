'use strict';

// One verified release for the shader, both client architectures and helper.
// Never mix host protocol versions. Digest supplied by GitHub's release API.
module.exports = {
  version: '0.12.0',
  archive: ['DLSS5-Feeder-0.12.0.zip', 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/download/v0.12.0/DLSS5-Feeder-0.12.0.zip', 'e970537996f6e73dce9a510b9e015fad19f148ee736dc4f518ccdebf6f012558'],
  hashes: {
    'dlss5-feed.addon32': 'd2df9fbf9b5e0cc24291b9240e4f8dd2aae063592571bbed37302878b6dac74c',
    'dlss5-feed.addon64': '066eec8c797df2d656f2ab2324278921b1dd6e9116c9945294f4a00f7fec608a',
    'dlss5-feed-host64.exe': '397dbf49c3a2b5f3bc13cfa0e0b3df4316edae9c45be7379bcacad066ebb07f2',
    'reshade-shaders/Shaders/DLSS5_Feed.fx': '955d911d3b567c57f4e0b44e528dae3f3df286fd8fd3e775b9f6b5ddd561aa94',
    // Feeder's own loader layer. A Vulkan game whose driver does not expose
    // the KHR external-interop extensions needs it for one launch.
    /* 'layer-x64/VkLayer_feed_vk.dll': '981248c994add83991d633cb7ddbc6a842ab26185d9029b837cb2d43acd1eac1',
    'layer-x64/VkLayer_feed_vk.json': 'c15967b3f8847a145e21058a1e57e92c595ee17fc5dd23ab3278b0148ad6e9d1',
    'layer-x64/run-with-feed-layer.bat': 'bc9aa7964742e23653556be978f540f503f3cef928b6de7a38f77c570bb764f9',
    'layer-x86/VkLayer_feed_vk32.dll': 'df8c70a9cc95b6f9656af2e7f4b09978c47434446e982d238db61933076c00b2',
    'layer-x86/VkLayer_feed_vk32.json': '28f8174eb8fed02266bafa6910eab07922ec6d2bdb33110699c586f74b254921',
    'layer-x86/run-with-feed-layer32.bat': '75d4584ad01619402a10e0d8342b114613057a1d3b0ac8dbe9280b740090c3e8' */
  }
};

// Keep the known-good release available while allowing newer Feeder builds to
// be tested per machine. The first entry is the default for existing users.
module.exports.VERSIONS = [
  module.exports,
  {
    version: '0.14.0-beta.4',
    archive: ['DLSS5-Feeder-0.14.0-beta.4.zip', 'https://github.com/jlrouzies-fr/DLSS5-Feeder/releases/download/v0.14.0-beta.4/DLSS5-Feeder-0.14.0-beta.4.zip', '7ee5d63e0674129e263d991c167466ea38909ff9358c2f07eb02a13cef70933f'],
    hashes: {
      'dlss5-feed.addon32': '0da474f208ce9b38a0bb9025b789f4169bf1a86c72a5c853a77ac816318f0d77',
      'dlss5-feed.addon64': '03545edcca1153f27cecb7ade8cd9a0420370748ae54e55e83119bec0c5075f1',
      'dlss5-feed-host64.exe': '3ed3ab48691ae1120867a4dc21ef6d85a6c8d4fd4d22f20400213f1f918e5e26',
      'reshade-shaders/Shaders/DLSS5_Feed.fx': 'cdac08a721b14b97187dd86c5b5bead157c9063d7ee859a0f131a8ee791695f1'
    }
  }
];

module.exports.release = version => module.exports.VERSIONS.find(item => item.version === version) || module.exports;
