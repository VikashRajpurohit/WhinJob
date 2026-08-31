import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform, StyleSheet } from 'react-native';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { SearchScreen } from '@/screens/SearchScreen';
import { TrackerScreen } from '@/screens/TrackerScreen';
import { colors, spacing, typography } from '@/theme';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: Record<
  keyof MainTabParamList,
  { label: string; active: IoniconName; inactive: IoniconName }
> = {
  Dashboard: { label: 'Jobs', active: 'briefcase', inactive: 'briefcase-outline' },
  Search: { label: 'Search', active: 'search', inactive: 'search-outline' },
  Tracker: {
    label: 'Tracker',
    active: 'checkmark-done-circle',
    inactive: 'checkmark-done-circle-outline',
  },
  Profile: { label: 'Profile', active: 'person', inactive: 'person-outline' },
};

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // Each screen renders its own ScreenHeader — the navigator's header would
        // put a second title directly above it.
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarLabel: TABS[route.name].label,
        tabBarIcon: ({ focused, color }) => (
          <Ionicons
            name={focused ? TABS[route.name].active : TABS[route.name].inactive}
            color={color}
            size={23}
          />
        ),
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Tracker" component={TrackerScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingTop: spacing.sm,
  },
  label: { ...typography.overline, letterSpacing: 0.2, marginTop: 2 },
  item: { paddingVertical: spacing.xs },
});
