/**
 * A 3D emoji picture (Microsoft Fluent Emoji, MIT licence), served from
 * /emoji so it looks the same on every device. Decorative: no alt text.
 */
export default function Emoji3D({ name, size = 40, className = "" }) {
  return (
    <img
      className={`emoji-3d ${className}`}
      src={`/emoji/${name}.png`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable="false"
    />
  );
}
