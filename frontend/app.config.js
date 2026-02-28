export default ({ config }) => {
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      '@react-native-firebase/app',
      '@react-native-firebase/messaging',
    ],
    scheme: ['orito', 'com.aura.app'],
    extra: {
      backendUrl: 'http://10.75.254.142:8001',
    },
  };
};
