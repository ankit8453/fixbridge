import { useState } from 'react';
import { useAddresses } from '@/surfaces/customer/data/addresses';
import {
  getCurrentLocation,
  GeoError,
  type GeoCoords,
  type GeoErrorReason,
} from '@/surfaces/customer/data/geo';
import type { AddressResponse } from '@/surfaces/customer/data/types';

export type LocationSource = 'address' | 'geolocation' | 'none';

export interface ResolvedLocation {
  coords: GeoCoords | null;
  /** Human label for the chip — an address's landmark/label, or "current location". */
  label: string | null;
  source: LocationSource;
  addresses: AddressResponse[];
  selectedAddress: AddressResponse | null;
  selectAddress: (address: AddressResponse) => void;
  useMyLocation: () => Promise<void>;
  requestingGeo: boolean;
  geoError: GeoErrorReason | null;
  addressesLoading: boolean;
}

/**
 * Where "here" means, for the Find/search screens.
 *
 * Defaults to the customer's default saved address (no permission prompt
 * needed — the common case for a returning customer); falls back to nothing
 * until they either save an address or tap "use my location". There is no
 * silent geolocation prompt on page load: asking for a location permission
 * before the customer has done anything is exactly the pattern that gets a
 * "never allow" tap on a cheap Android phone. Ported from
 * `legacy-next-src/components/customer/find/useResolvedLocation.ts`.
 */
export function useResolvedLocation(): ResolvedLocation {
  const { data, isLoading } = useAddresses();
  const addresses = data?.addresses ?? [];
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;

  const [manualAddress, setManualAddress] = useState<AddressResponse | null>(null);
  const [geo, setGeo] = useState<GeoCoords | null>(null);
  const [requestingGeo, setRequestingGeo] = useState(false);
  const [geoError, setGeoError] = useState<GeoErrorReason | null>(null);

  const selectedAddress = manualAddress ?? defaultAddress;

  async function useMyLocation() {
    setRequestingGeo(true);
    setGeoError(null);
    try {
      const coords = await getCurrentLocation();
      setGeo(coords);
      setManualAddress(null); // geolocation explicitly overrides an address pick
    } catch (err) {
      setGeoError(err instanceof GeoError ? err.reason : 'unavailable');
    } finally {
      setRequestingGeo(false);
    }
  }

  if (selectedAddress) {
    return {
      coords: selectedAddress.location,
      label: selectedAddress.labelText ?? selectedAddress.label,
      source: 'address',
      addresses,
      selectedAddress,
      selectAddress: setManualAddress,
      useMyLocation,
      requestingGeo,
      geoError,
      addressesLoading: isLoading,
    };
  }

  if (geo) {
    return {
      coords: geo,
      label: null,
      source: 'geolocation',
      addresses,
      selectedAddress: null,
      selectAddress: setManualAddress,
      useMyLocation,
      requestingGeo,
      geoError,
      addressesLoading: isLoading,
    };
  }

  return {
    coords: null,
    label: null,
    source: 'none',
    addresses,
    selectedAddress: null,
    selectAddress: setManualAddress,
    useMyLocation,
    requestingGeo,
    geoError,
    addressesLoading: isLoading,
  };
}
