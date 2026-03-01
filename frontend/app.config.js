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
      // Backend URL resolution order:
      //   1. EXPO_PUBLIC_BACKEND_URL env var (set in .env or CI)
      //   2. BACKEND_URL env var
      //   3. 10.0.2.2:8001 (Android emulator → host machine localhost)
      //
      // To change for a physical device, set in frontend/.env:
      //   EXPO_PUBLIC_BACKEND_URL=http://192.168.x.x:8001
      backendUrl: process.env.EXPO_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || 'http://10.0.2.2:8001',
    },
  };
};
