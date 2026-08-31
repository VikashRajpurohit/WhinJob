import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import type { Theme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppBootGate } from '@/components/AppBootGate';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { RootNavigator } from '@/navigation/RootNavigator';
import { colors } from '@/theme';

/** Stops React Navigation painting its own greys between screen transitions. */
const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Migrations run before auth, so hydration always has tables to write into. */}
      <AppBootGate>
        <AuthProvider>
          <NavigationContainer theme={navigationTheme}>
            <StatusBar style="dark" />
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </AppBootGate>
    </SafeAreaProvider>
  );
}
