import * as React from 'react';
import { Pressable, Text, ActivityIndicator, ViewStyle, TextStyle, StyleSheet } from 'react-native';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  testID?: string;
}

const palette = {
  primary: { bg: '#0F172A', fg: '#FFFFFF', border: '#0F172A' },
  secondary: { bg: '#FFFFFF', fg: '#0F172A', border: '#CBD5E1' },
  ghost: { bg: 'transparent', fg: '#0F172A', border: 'transparent' },
  danger: { bg: '#DC2626', fg: '#FFFFFF', border: '#DC2626' },
};

export function Button({ title, onPress, variant = 'primary', size = 'lg', loading, disabled, style, textStyle, testID }: Props) {
  const c = palette[variant];
  const height = size === 'lg' ? 56 : size === 'md' ? 48 : 40; // 48dp+ for field use
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: c.bg, borderColor: c.border, height, opacity: pressed ? 0.85 : disabled ? 0.5 : 1 },
        style,
      ]}
      hitSlop={8}
    >
      {loading ? <ActivityIndicator color={c.fg} /> : <Text style={[styles.text, { color: c.fg, fontSize: size === 'lg' ? 16 : 14 }, textStyle]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    minWidth: 120,
  },
  text: { fontWeight: '700', letterSpacing: 0.2 },
});
