import { shallowRef } from 'vue';

import { useAppConfig } from '@vben/hooks';

import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

import { onlineHubUrl, OnlineSession, type OnlineStatus } from './online-session';

export const onlineStatus = shallowRef<OnlineStatus>('disconnected');

export const onlineSession = new OnlineSession(
	(accessTokenFactory) => {
		const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
		return new HubConnectionBuilder()
			.withUrl(onlineHubUrl(apiURL), { accessTokenFactory })
			.withAutomaticReconnect({ nextRetryDelayInMilliseconds: () => 5000 })
			.configureLogging(LogLevel.None)
			.build();
	},
	(status) => {
		onlineStatus.value = status;
	}
);
