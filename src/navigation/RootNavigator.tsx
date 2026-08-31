import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@/features/auth/AuthProvider';
import { AddJobScreen } from '@/screens/AddJobScreen';
import { JobDetailScreen } from '@/screens/JobDetailScreen';
import { ResumesScreen } from '@/screens/ResumesScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { colors } from '@/theme';
import { AuthStack } from './AuthStack';
import { stackScreenOptions } from './screenOptions';
import { TabNavigator } from './TabNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { session, ready } = useAuth();

  // Holding here avoids a sign-in screen flashing before the persisted session
  // has been read back out of the Keychain (FR-1).
  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      {session ? (
        <Stack.Group>
          <Stack.Screen name="Main" component={TabNavigator} options={{ headerShown: false }} />
          <Stack.Screen name="JobDetail" component={JobDetailScreen} options={{ title: 'Job' }} />
          <Stack.Screen name="AddJob" component={AddJobScreen} options={{ title: 'Add a job' }} />
          <Stack.Screen name="Resumes" component={ResumesScreen} options={{ title: 'Resumes' }} />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Keys & models' }}
          />
        </Stack.Group>
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
