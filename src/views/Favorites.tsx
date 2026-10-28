import { player, usePlayer } from "../lib/player";
import { Icon } from "../components/Icons";
import { TrackTable } from "../components/TrackTable";

export function Favorites() {
  const { tracks } = usePlayer();
  const favs = tracks.filter((t) => t.favorite);
  return (
    <div className="page">
      <h1>Favorites</h1>
      <p className="lead">{favs.length} favorite track{favs.length === 1 ? "" : "s"}</p>
      {favs.length === 0 ? (
        <div className="glass empty"><h2>No favorites yet</h2><p>Tap the heart next to any track in your library to keep it here.</p></div>
      ) : (
        <>
          <div className="toolbar"><button className="btn primary" onClick={() => void player.playList(favs.map((t) => t.id), 0)}><Icon name="play" />Play favorites</button></div>
          <TrackTable tracks={favs} />
        </>
      )}
    </div>
  );
}
