import { describe, expect, it } from 'vitest';

import { parseDialContact } from './call-tel';

describe('公开拨号链接', () => {
  const data = { realName: '测试联系人', number: '+86 (138) 0013-8000' };
  it.each([JSON.stringify(data), encodeURIComponent(JSON.stringify(data))])('支持路由解码后的单层及旧双层编码', code => {
    expect(parseDialContact(code)).toEqual({ name: '测试联系人', number: data.number, href: 'tel:+8613800138000' });
  });
  it.each([undefined, ['{}'], '%broken', '{}', '{"number":"javascript:alert(1)"}', '{"number":"13800138000;ext=1"}'])('无效内容不能产生拨号地址', code => {
    expect(parseDialContact(code)).toBeUndefined();
  });
});
