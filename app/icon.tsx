import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8F4ED", borderRadius: 16, color: "#A9556D", fontSize: 44, fontWeight: 600, fontFamily: "serif" }}>
        G
      </div>
    ),
    size,
  );
}
