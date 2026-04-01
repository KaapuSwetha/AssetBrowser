from django import template

register = template.Library()

DEPT_MAP = {
    "01_Concepts":  "border-sky-500/60 text-sky-300",
    "02_Scans":     "border-cyan-500/60 text-cyan-300",
    "03_Model":     "border-teal-500/60 text-teal-300",
    "04_Texture":   "border-rose-500/60 text-rose-300",
    "05_Groom":     "border-amber-500/60 text-amber-300",
    "06_Lookdev":   "border-fuchsia-500/60 text-fuchsia-300",
    "07_Rig":       "border-orange-500/60 text-orange-300",
    "08_Layout":    "border-emerald-500/60 text-emerald-300",
    "09_Animation": "border-violet-500/60 text-violet-300",
    "10_Cfx":       "border-indigo-500/60 text-indigo-300",
    "11_Cache":     "border-slate-500/60 text-slate-300",
    "12_Lighting":  "border-sky-400/60 text-sky-200",
    "13_Render":    "border-cyan-400/60 text-cyan-200",
    "14_Comp":      "border-lime-500/60 text-lime-300",
    "15_Fx":        "border-red-500/60 text-red-300",
    "16_Matchmove": "border-yellow-500/60 text-yellow-300",
    "17_Roto":      "border-zinc-500/60 text-zinc-300",
    "18_Paint":     "border-pink-500/60 text-pink-300",
    "19_Dmp":       "border-green-500/60 text-green-300",
    "20_Env":       "border-lime-600/60 text-lime-300",
}
DEFAULT_CLS = "border-slate-600/60 text-slate-300"

@register.filter
def dept_badge_cls(dept_name: str) -> str:
    return DEPT_MAP.get(dept_name, DEFAULT_CLS)
