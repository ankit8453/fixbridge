import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/Button';
import { controlClass } from '@/components/ui/Field';
import { useT } from '@/i18n/useT';
import {
  describePlace,
  getCurrentLocation,
  searchPlaces,
  type GeoCoords,
  type PlaceSuggestion,
} from '@/surfaces/customer/data/geo';

/** Jabalpur. Where the map opens when there is nothing better to open on. */
const CITY_CENTRE: GeoCoords = { lat: 23.1815, lng: 79.9864 };

/**
 * Choosing exactly where a job is, on the website.
 *
 * The pin is fixed to the centre of the frame and the **map moves underneath
 * it** — the same as the app, and the same as every delivery service people
 * already know. A draggable marker is worse on a touch screen: the finger
 * covers the thing being placed.
 *
 * Two things this replaces. The form used to offer "use my current location"
 * as an optional button, so most addresses were saved with no coordinates at
 * all and the server guessed them from the text. And where somebody is
 * standing is only the right answer when they are at the address — plenty are
 * not, booking for a parent or a shop across town.
 */
export function MapPicker({
  initial,
  onConfirm,
  onCancel,
}: {
  initial?: GeoCoords | null;
  onConfirm: (point: GeoCoords, label: string | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const mapRef = useRef<LeafletMap | null>(null);

  const [centre, setCentre] = useState<GeoCoords>(initial ?? CITY_CENTRE);
  const [label, setLabel] = useState<string | null>(null);
  const [servedHere, setServedHere] = useState(true);
  const [naming, setNaming] = useState(false);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [locating, setLocating] = useState(false);

  /**
   * Names whatever the pin is over.
   *
   * Debounced by the caller, not here. The lookup behind it is rate limited
   * for the whole application, so firing one per frame of a drag would spend
   * everybody's budget on one person's mouse.
   */
  const nameCentre = useCallback(async (point: GeoCoords) => {
    setNaming(true);
    const place = await describePlace(point);
    setLabel(place.label);
    setServedHere(place.servedHere);
    setNaming(false);
  }, []);

  // Opens on the browser's fix for a new address. No prompt for an existing
  // one — opening on the pin already saved is the whole point of editing it.
  useEffect(() => {
    if (initial) {
      void nameCentre(initial);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const here = await getCurrentLocation();
        if (cancelled) return;
        setCentre(here);
        mapRef.current?.setView([here.lat, here.lng], 16);
        void nameCentre(here);
      } catch {
        // Refused or unavailable. The map is already on Jabalpur and the
        // search box works — slower, never blocked, and never nagged.
        if (!cancelled) void nameCentre(CITY_CENTRE);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initial, nameCentre]);

  // Debounced search. Same budget, same reasoning as the naming lookup.
  useEffect(() => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSuggestions(await searchPlaces(query));
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  async function useMyLocation() {
    setLocating(true);
    try {
      const here = await getCurrentLocation();
      setCentre(here);
      mapRef.current?.setView([here.lat, here.lng], 16);
      void nameCentre(here);
    } catch {
      // Nothing to say. The browser has already shown its own refusal.
    } finally {
      setLocating(false);
    }
  }

  function pick(suggestion: PlaceSuggestion) {
    setCentre(suggestion.point);
    setSuggestions([]);
    setQuery('');
    mapRef.current?.setView([suggestion.point.lat, suggestion.point.lng], 16);
    void nameCentre(suggestion.point);
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          className={`${controlClass} pl-9`}
          placeholder={t('customer.address.map.searchHint')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {suggestions.length > 0 ? (
          <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {suggestions.map((suggestion) => (
              <li key={`${suggestion.point.lat},${suggestion.point.lng}`}>
                <button
                  type="button"
                  onClick={() => pick(suggestion)}
                  className="flex min-h-touch w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="line-clamp-2">{suggestion.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="relative h-72 overflow-hidden rounded-lg border border-slate-200">
        <MapContainer
          center={[centre.lat, centre.lng]}
          zoom={initial ? 16 : 13}
          minZoom={11}
          maxZoom={18}
          scrollWheelZoom
          className="h-full w-full"
          ref={mapRef}
        >
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          <CentreWatcher onSettled={(point) => {
            setCentre(point);
            void nameCentre(point);
          }} />
        </MapContainer>

        {/* The pin. Fixed dead centre, lifted so its tip marks the point
            rather than the middle of the icon. */}
        <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center">
          <MapPin
            className={`h-9 w-9 -translate-y-4 ${servedHere ? 'text-slate-900' : 'text-danger'}`}
            fill="currentColor"
            aria-hidden="true"
          />
        </div>

        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          aria-label={t('customer.address.map.useMyLocation')}
          className="absolute bottom-3 right-3 z-[400] flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md hover:bg-slate-50"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Crosshair className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <p className={`text-sm ${servedHere ? 'text-muted' : 'font-medium text-danger'}`}>
        {!servedHere
          ? t('customer.address.map.outsideArea')
          : naming
            ? t('customer.address.map.finding')
            : (label ?? t('customer.address.map.hint'))}
      </p>

      <div className="flex gap-3">
        <Button
          variant="primary"
          disabled={!servedHere}
          onClick={() => onConfirm(centre, label)}
        >
          {t('customer.address.map.confirm')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Reports the centre once the map stops moving.
 *
 * `moveend` rather than `move`: the pin follows the map for free because it is
 * painted over the middle of the frame, so the only thing the parent needs is
 * the final point — and a lookup per frame would exhaust a shared rate limit.
 */
function CentreWatcher({ onSettled }: { onSettled: (point: GeoCoords) => void }) {
  useMapEvents({
    moveend(event) {
      const centre = event.target.getCenter();
      onSettled({ lat: centre.lat, lng: centre.lng });
    },
  });

  return null;
}
