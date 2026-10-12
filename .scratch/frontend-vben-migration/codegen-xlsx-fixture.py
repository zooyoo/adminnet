"""读写隔离验收的真实 Excel 模板和导出数据。"""
import argparse
import datetime
import json
from pathlib import Path
from openpyxl import load_workbook

def plain(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    return value

def title(value):
    return str(value or '').strip().lstrip('*').strip()

def headers(sheet):
    for index, row in enumerate(sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 30), values_only=True), 1):
        if any(title(value) == '名称' for value in row):
            return index, [title(value) for value in row]
    raise ValueError('真实工作簿缺少名称表头')

parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['inspect', 'populate'])
parser.add_argument('source')
parser.add_argument('--output')
parser.add_argument('--rows')
args = parser.parse_args()
source = Path(args.source).resolve(strict=True)
workbook = load_workbook(source, read_only=args.mode == 'inspect', data_only=args.mode == 'inspect')
try:
    sheet = workbook.worksheets[0]
    header_row, names = headers(sheet)
    if args.mode == 'inspect':
        rows = [{name: plain(value) for name, value in zip(names, values) if name} for values in sheet.iter_rows(min_row=header_row + 1, max_row=sheet.max_row, values_only=True) if any(value is not None for value in values)]
        print(json.dumps({'sheet': sheet.title, 'headers': names, 'rows': rows}, ensure_ascii=False))
    else:
        if not args.output or not args.rows:
            raise ValueError('populate 必须指定隔离输出和行数据')
        payload = json.loads(Path(args.rows).read_text(encoding='utf-8-sig'))
        if not isinstance(payload, list) or len(payload) > 100:
            raise ValueError('验收行数据格式无效')
        output = Path(args.output).resolve()
        if output == source:
            raise ValueError('不覆盖真实下载模板')
        if sheet.max_row > header_row:
            sheet.delete_rows(header_row + 1, sheet.max_row - header_row)
        for offset, values in enumerate(payload, header_row + 1):
            for name, value in values.items():
                if name not in names:
                    raise ValueError('模板没有指定验收列：' + name)
                cell = sheet.cell(offset, names.index(name) + 1)
                if isinstance(value, dict) and set(value) == {'dateTime'}:
                    cell.value = datetime.datetime.fromisoformat(value['dateTime'])
                    cell.number_format = 'yyyy-mm-dd hh:mm:ss'
                else:
                    cell.value = value
        workbook.save(output)
        print(json.dumps({'output': str(output), 'headers': names, 'rows': len(payload)}, ensure_ascii=False))
finally:
    workbook.close()