interface SparklineChartProps {
  data: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  label?: string;
}

export default function SparklineChart({
  data,
  width = 80,
  height = 24,
  color = "#10b981",
  fillColor = "rgba(16, 185, 129, 0.15)",
  label,
}: SparklineChartProps) {
  const values = data.filter((v): v is number => v !== null);
  if (values.length < 2) {
    return (
      <div className="flex items-center gap-1.5">
        <div
          className="rounded bg-surface-tertiary"
          style={{ width, height }}
        />
        {label && (
          <span className="text-[10px] text-foreground-muted whitespace-nowrap">
            {label}
          </span>
        )}
      </div>
    );
  }

  const max = Math.max(...values, 100);
  const min = 0;
  const range = max - min || 1;
  const padding = 1;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (v - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const fillPath = `${linePath} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`;

  return (
    <div className="flex items-center gap-1.5">
      <svg width={width} height={height} className="block">
        <path d={fillPath} fill={fillColor} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label && (
        <span className="text-[10px] text-foreground-muted whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
}
