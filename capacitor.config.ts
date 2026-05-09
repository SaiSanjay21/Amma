import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.remindme.ai',
  appName: 'RemindMe AI',
  webDir: 'dist',
  backgroundColor: '#f5f0e8',
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#f5f0e8',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#5d4037',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#6C5CE7',
      sound: 'notification.wav',
    },
    SocialLogin: {
      google: {
        webClientId: '268608325920-0ungraf36u5kfdmr837mvgkj6npqcdhu.apps.googleusercontent.com',
      },
    },
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
