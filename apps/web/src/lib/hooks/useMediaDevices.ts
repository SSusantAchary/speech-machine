import { useEffect, useState } from "react";

type DeviceState = {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  error: string | null;
};

export const useMediaDevices = (enabled = true) => {
  const [state, setState] = useState<DeviceState>({ cameras: [], microphones: [], error: null });

  useEffect(() => {
    if (!enabled) {
      setState({ cameras: [], microphones: [], error: null });
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setState({ cameras: [], microphones: [], error: "Media devices API unavailable" });
      return;
    }

    let active = true;
    const mediaDevices = navigator.mediaDevices;

    const load = async () => {
      try {
        const devices = await mediaDevices.enumerateDevices();
        if (!active) return;
        setState({
          cameras: devices.filter((d) => d.kind === "videoinput"),
          microphones: devices.filter((d) => d.kind === "audioinput"),
          error: null,
        });
      } catch (_error) {
        if (!active) return;
        setState({ cameras: [], microphones: [], error: "Unable to list devices" });
      }
    };

    load();

    if (typeof mediaDevices.addEventListener === "function") {
      mediaDevices.addEventListener("devicechange", load);
      return () => {
        active = false;
        mediaDevices.removeEventListener("devicechange", load);
      };
    }

    return () => {
      active = false;
    };
  }, [enabled]);

  return state;
};
