import { Linking, Platform } from 'react-native';

export function openNavigation(address: string, lat?: number, lng?: number) {
  const query = lat && lng ? `${lat},${lng}` : encodeURIComponent(address);
  const url = Platform.OS === 'ios' ? `maps://?q=${query}` : `geo:${lat ?? 0},${lng ?? 0}?q=${query}`;
  const fallback = `https://www.google.com/maps/search/?api=1&query=${query}`;
  Linking.canOpenURL(url).then(supported => {
    if (supported) Linking.openURL(url);
    else Linking.openURL(fallback);
  });
}

export function openDialer(phone: string) {
  Linking.openURL(`tel:${phone}`);
}
