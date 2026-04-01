import json
import os

ANIMATION_ROOT = r"N:\GoldenHour\04_Publish\09_Animation"
COMMON_DIR = "Y:/AssetPublishPipeData/PublishData/projects"

def json_extract(json_file_path):
    if not os.path.isfile(json_file_path):
        print(f"[ERROR] File not found: {json_file_path}")
        return

    try:
        with open(json_file_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f).get("asset_id_info")
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON decode error in file {json_file_path}: {e}")
        return

    if not raw_data:
        print(f"[WARNING] No 'asset_id_info' found in {json_file_path}")
        return

    for project, department_dict in raw_data.items():
        for department, subdept_dict in department_dict.items():
            for subdept, assets in subdept_dict.items():
                out_dir = os.path.join(COMMON_DIR, project, "Asset", department, subdept)
                os.makedirs(out_dir, exist_ok=True)
                out_path = os.path.join(out_dir, f"{project}_{department}_{subdept}_asset_info.json")
                asset_info = {'asset_info': assets}

                with open(out_path, "w", encoding='utf-8') as f:
                    json.dump(asset_info, f, indent=4, sort_keys=True)

                print(f"[WRITE] {out_path}")

    print(f"[SUCCESS] Complete asset info written from: {json_file_path}")

def extract_shots():
    project = "GH"
    department = "09_Animation"
    shot_data_by_seq = {}

    for sequence in os.listdir(ANIMATION_ROOT):
        seq_path = os.path.join(ANIMATION_ROOT, sequence)
        if not os.path.isdir(seq_path):
            continue

        for shot in os.listdir(seq_path):
            shot_path = os.path.join(seq_path, shot)
            if not os.path.isdir(shot_path):
                continue

            files = os.listdir(shot_path)
            shot_entry = {
                "PublishdFilePath": [],
                "PreviewPath": [],
                "SideBySide": [],
                "WorkFilePath": [],
                "User": [],
                "FrameRange": [],
                "FrameRate": [],
                "PublishComment": [],
                "Status": []
            }

            side_by_side_found = False

            for file in files:
                full_path = os.path.join(shot_path, file).replace("\\", "/")
                file_lower = file.lower()

                if file_lower.endswith(".ma"):
                    shot_entry["PublishdFilePath"].append(full_path)
                    shot_entry["Status"].append("Internal Approved")
                    shot_entry["PublishComment"].append(None)
                elif "side_by_side" in file_lower and file_lower.endswith(".mov"):
                    shot_entry["SideBySide"].append(full_path)
                    side_by_side_found = True
                elif file_lower.endswith(".mov"):
                    shot_entry["PreviewPath"].append(full_path)

            if not side_by_side_found:
                shot_entry["SideBySide"].append(None)

            package_dir = os.path.join(shot_path, "package")
            if os.path.isdir(package_dir):
                for pkg_file in os.listdir(package_dir):
                    if pkg_file.endswith(".json"):
                        pkg_path = os.path.join(package_dir, pkg_file)
                        try:
                            with open(pkg_path, 'r', encoding='utf-8') as pf:
                                pkg_data = json.load(pf)

                            if "packaging_info" in pkg_data:
                                user = pkg_data["packaging_info"].get("username", "")
                                if user:
                                    shot_entry["User"].append(user)

                            if "file_info" in pkg_data:
                                source = pkg_data["file_info"].get("source_file", "")
                                if source:
                                    shot_entry["WorkFilePath"].append(source.replace("\\", "/"))

                                frame_start = pkg_data["file_info"].get("first_frame", "")
                                frame_end = pkg_data["file_info"].get("last_frame", "")
                                if frame_start != "" and frame_end != "":
                                    shot_entry["FrameRange"].append(f"{int(frame_start)}-{int(frame_end)}")

                                rate = pkg_data["file_info"].get("Time", "")
                                if rate:
                                    shot_entry["FrameRate"].append(rate)
                        except Exception as e:
                            print(f"[ERROR] Package read failed: {pkg_path}\n{e}")

            if any(shot_entry.values()):
                if sequence not in shot_data_by_seq:
                    shot_data_by_seq[sequence] = {"sequence_info": {}}

                shot_data_by_seq[sequence]["sequence_info"][shot] = shot_entry

    for seq, shot_block in shot_data_by_seq.items():
        out_dir = os.path.join(COMMON_DIR, project, "Sequence", department, seq)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{project}_{department}_{seq}_sequence_info.json")

        with open(out_path, "w", encoding='utf-8') as f:
            json.dump(shot_block, f, indent=4, sort_keys=True)

        print(f"[WRITE] {out_path}")

    print("[SUCCESS] Shot animation data exported.")

if __name__ == "__main__":
    json_path = r"Y:\AssetPublishPipeData\PublishData\projects\asset_id_info_data.json"
    json_extract(json_path)
    # extract_shots()
