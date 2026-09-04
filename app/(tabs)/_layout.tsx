import * as React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0F172A',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarStyle: { height: 64, paddingBottom: 8, paddingTop: 8, backgroundColor: '#FFF', borderTopColor: '#E2E8F0' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="jobs" options={{ title: 'Jobs', tabBarIcon: () => <Text style={{ fontSize: 20 }}>🗂</Text> }} />
      <Tabs.Screen name="checklists" options={{ title: 'Safety', tabBarIcon: () => <Text style={{ fontSize: 20 }}>✓</Text> }} />
      <Tabs.Screen name="invoices" options={{ title: 'Invoices', tabBarIcon: () => <Text style={{ fontSize: 20 }}>＄</Text> }} />
      <Tabs.Screen name="settings" options={{ href: null, title: 'Settings' }} />
      <Tabs.Screen name="team" options={{ title: 'Team', tabBarIcon: () => <Text style={{ fontSize: 20 }}>👥</Text> }} />
    </Tabs>
  );
}
