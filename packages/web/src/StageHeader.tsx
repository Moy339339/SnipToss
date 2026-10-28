import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import type { Tool } from "./annotate";
import { baseName, type MaterialEntry } from "./host";
import { formatSize } from "./formatSize";
import {
  ArrowIcon,
  ClockIcon,
  GearIcon,
  HelpIcon,
  MoreIcon,
  NoteIcon,
  PenIcon,
  PointIcon,
  RectIcon,
  RedoIcon,
  SelectIcon,
  UndoIcon,
  HandIcon,
} from "./icons";
import { TOOLS } from "./appMenus";
import { Menu } from "./Menu";
import { PanelIcon } from "./Panels";

/** Tool buttons: the tooltip message is tool.<tool>.tip, the shortcuts are the same as the menu's (TOOLS in appMenus) */
const TOOL_ICONS: Record<Tool, ReactNode> = {
  select: <SelectIcon />,
  hand: <HandIcon />,
  point: <PointIcon />,
  rect: <RectIcon />,
  pen: <PenIcon />,
  arrow: <ArrowIcon />,
};

/** Toolbar button tooltip: description + fullwidth space + shortcut (Tooltip draws the part after the space as a keycap) */
const tip = (label: string, keys: string) => `${label}\u3000${keys}`;

/** The toolbar above the canvas: every action is reachable with the mouse */
export function StageHeader(props: {
  material?: MaterialEntry;
  dims?: { w: number; h: number };
  tool: Tool;
  canAnnotate: boolean;
  /** Marks can be drawn on the canvas (when the canvas cannot open, the drawing tools are grayed out but overall comments can still be written) */
  canDraw: boolean;
  canUndo: boolean;
  canRedo: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  onTool: (t: Tool) => void;
  onWhole: () => void;
  /** Timestamped comment: only provided for video (when the canvas can open); the button exists only when this is given */
  onTimed?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onSettings: () => void;
  onHelp: () => void;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const m = props.material;
  const name = m ? baseName(m.path) : "";

  return (
    <header className="stage-header">
      {/* The left and right blocks are equally wide, so the tool group sits in the exact center */}
      <div className="hdr-left">
        <button
          className={`hdr-btn${props.leftOpen ? " is-on" : ""}`}
          onClick={props.onToggleLeft}
          title={t("header.toggleLeft", { open: props.leftOpen ? "yes" : "no" })}
        >
          <PanelIcon side="left" open={props.leftOpen} />
        </button>

        <div className="hdr-file" title={m?.path}>
          {m ? (
            <>
              <span className="hdr-name">{name}</span>
              <span className="hdr-meta">
                {t(`kind.${m.kind}`)}
                {props.dims && ` · ${props.dims.w}×${props.dims.h}`} · {formatSize(m.size)}
              </span>
            </>
          ) : (
            <span className="hdr-meta">{t("header.noMaterial")}</span>
          )}
        </div>
      </div>

      <div className="hdr-tools" role="toolbar" aria-label={t("header.tools")}>
        {TOOLS.map((tool) => (
          <button
            key={tool.tool}
            className={`tool-btn${props.tool === tool.tool ? " is-on" : ""}`}
            onClick={() => props.onTool(tool.tool)}
            disabled={!props.canDraw && tool.tool !== "select" && tool.tool !== "hand"}
            data-tip={tip(t(`tool.${tool.tool}.tip`), tool.key)}
            aria-label={t(`tool.${tool.tool}`)}
          >
            {TOOL_ICONS[tool.tool]}
          </button>
        ))}
        <span className="hdr-sep" />
        {/* On video, the two kinds of comment without a position sit side by side: the one for this moment (timestamped comment) and the one for the whole video (overall comment); images only have the overall comment */}
        {props.onTimed && (
          <button
            className="tool-btn tool-text tool-timed"
            onClick={props.onTimed}
            disabled={!props.canAnnotate}
            data-tip={tip(t("header.timedTip"), "T")}
          >
            <ClockIcon />
            <span>{t("header.timed")}</span>
          </button>
        )}
        <button
          className="tool-btn tool-text"
          onClick={props.onWhole}
          disabled={!props.canAnnotate}
          data-tip={tip(t("header.wholeTip"), "N")}
        >
          <NoteIcon />
          <span>{t("header.whole")}</span>
        </button>
        {/* Items with hdr-wide fold into the "⋯" on the right when the canvas is narrow (in a 944-wide window the "?" was covered by the tool group and the notes panel toggle was not visible) */}
        <span className="hdr-sep hdr-wide" />
        <button
          className="tool-btn hdr-wide"
          onClick={props.onUndo}
          disabled={!props.canUndo}
          data-tip={tip(t("cmd.undo"), "Ctrl Z")}
          aria-label={t("cmd.undo")}
        >
          <UndoIcon />
        </button>
        <button
          className="tool-btn hdr-wide"
          onClick={props.onRedo}
          disabled={!props.canRedo}
          data-tip={tip(t("cmd.redo"), "Ctrl Shift Z")}
          aria-label={t("cmd.redo")}
        >
          <RedoIcon />
        </button>
      </div>

      <div className="hdr-right">
        <button className="hdr-btn hdr-wide" onClick={props.onSettings} title={t("header.settings")}>
          <GearIcon />
        </button>
        <button className="hdr-btn hdr-wide" onClick={props.onHelp} title={t("header.shortcuts")}>
          <HelpIcon />
        </button>
        <span className="hdr-more">
          <Menu
            trigger={() => <MoreIcon />}
            align="right"
            buttonClass="hdr-btn"
            title={t("header.more")}
            items={[
              {
                label: t("cmd.undo"),
                icon: <UndoIcon />,
                hint: "Ctrl Z",
                onClick: props.onUndo,
                disabled: !props.canUndo,
              },
              {
                label: t("cmd.redo"),
                icon: <RedoIcon />,
                hint: "Ctrl Shift Z",
                onClick: props.onRedo,
                disabled: !props.canRedo,
              },
              "-",
              { label: t("cmd.settings"), icon: <GearIcon />, hint: "Ctrl ,", onClick: props.onSettings },
              { label: t("cmd.shortcuts"), icon: <HelpIcon />, hint: "?", onClick: props.onHelp },
            ]}
          />
        </span>
        <button
          className={`hdr-btn${props.rightOpen ? " is-on" : ""}`}
          onClick={props.onToggleRight}
          title={t("header.toggleRight", { open: props.rightOpen ? "yes" : "no" })}
        >
          <PanelIcon side="right" open={props.rightOpen} />
        </button>
      </div>
    </header>
  );
}
