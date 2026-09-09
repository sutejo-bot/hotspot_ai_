function getFirmsChunks(days: number) {
    const chunks: { date: string; range: number }[] = [];
    const today = new Date();
    const cur = new Date(today);
    cur.setDate(cur.getDate() - (days - 1));
    let remaining = days;
    while (remaining > 0) {
      const take = Math.min(remaining, 5);
      const dateStr = cur.toISOString().split("T")[0];
      chunks.push({ date: dateStr, range: take });
      cur.setDate(cur.getDate() + take);
      remaining -= take;
    }
    return chunks;
}
console.log(getFirmsChunks(2));
console.log(getFirmsChunks(1));
