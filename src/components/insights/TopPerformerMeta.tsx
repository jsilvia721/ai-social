interface TopPerformerMetaProps {
  username: string;
  platformColorClass: string;
  topicPillar: string | null;
}

export function TopPerformerMeta({ username, platformColorClass, topicPillar }: TopPerformerMetaProps) {
  return (
    <p className={`text-xs mt-1 ${platformColorClass}`}>
      <span>@{username}</span>
      {topicPillar && (
        <>
          <span className="mx-1.5 text-zinc-600">·</span>
          <span className="text-zinc-500">{topicPillar}</span>
        </>
      )}
    </p>
  );
}
